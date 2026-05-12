# Production Architecture Refactoring Plan: AuditSample Pro 2.0
**Target:** High-Performance Data Layer (1M+ rows)
**Stack:** Electron, React, TypeScript, DuckDB, Parquet, Node.js Workers

---

## 1. Target Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────┐
│                       RENDERER PROCESS                      │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │ UI & Routes │   │ React Hooks  │   │ UI Virtual Table │  │
│  │ (No changes)│   │ (Data Adapter) │   │ (Pagination/DOM) │  │
│  └──────┬──────┘   └──────┬───────┘   └────────┬─────────┘  │
└─────────┼─────────────────┼────────────────────┼────────────┘
          │                 │                    │
          ▼                 ▼                    ▼
===============================================================
                       IPC BRIDGE (preload.ts) 
           (contextBridge.exposeInMainWorld('api', ...))
===============================================================
          │                 │                    │
          ▼                 ▼                    ▼
┌─────────┼─────────────────┼────────────────────┼────────────┐
│         │           MAIN PROCESS               │            │
│  ┌──────┴──────┐   ┌──────┴───────┐   ┌────────┴─────────┐  │
│  │ IPC Handlers│   │ Orchestrator │   │ Storage Manager  │  │
│  └──────┬──────┘   └──────┬───────┘   └────────┬─────────┘  │
│         │                 │                    │            │
│  ┌──────▼──────┐   ┌──────▼───────┐   ┌────────▼─────────┐  │
│  │ImportService│   │ QueryService │   │ ExportService    │  │
│  └──────┬──────┘   └──────┬───────┘   └────────┬─────────┘  │
│         │                 │                    │            │
│  ┌──────▼──────┐   ┌──────▼───────┐   ┌────────▼─────────┐  │
│  │Worker Pool  │   │  DuckDB Core │   │  Worker Pool     │  │
│  │(Node Threads│<─>│  (SQL Engine)│<─>│  (ExcelJS Stream)│  │
│  └──────┬──────┘   └──────┬───────┘   └────────┬─────────┘  │
└─────────┼─────────────────┼────────────────────┼────────────┘
          │                 │                    │
          ▼                 ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                        NATIVE LAYER                         │
│  [XLSX/CSV Files]     [Parquet Files]       [Export Files]  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Step-by-Step Refactoring Plan (Incremental)

We will use the **Strangler Fig Pattern** to replace the in-memory architecture without breaking the UI.

*   **Phase 1: Foundation Setup (Hidden)**
    *   Integrate `duckdb` and configure compilation for Electron.
    *   Setup the Node.js `worker_threads` pool in the Main process.
    *   Define the IPC interfaces in `preload.ts`.
*   **Phase 2: Adapter Layer Implementation (No UI changes)**
    *   Create a "Store Adapter" in React (e.g., `usePopulationAdapter`).
    *   Currently, it just accesses React state. We will rewire it to fetch padded pages from the IPC Main process.
*   **Phase 3: The Import Pipeline (Parallel Routing)**
    *   Modify `ImportStep.tsx` to call Main process via IPC instead of loading files using web APIs.
    *   Main process spawns a Worker to stream parse XLSX/CSV and insert directly into DuckDB -> Parquet.
    *   Worker sends lightweight `progress` events back to UI.
*   **Phase 4: Sampling & Query Engine Migration**
    *   Re-implement the core loop of `samplingEngine.ts` inside the Main process using SQL executed via DuckDB.
    *   Keep the original TypeScript functions purely for UI calculation mapping if necessary, but move heavy number-crunching to DuckDB aggregations.
*   **Phase 5: Export Pipeline Migration**
    *   Modify export functions to stream data directly from DuckDB -> Worker -> ExcelJS stream, circumventing JSON serialization.
*   **Phase 6: Cleanup & Memory Freeing**
    *   Completely remove `population` from the React global/local state contexts.
    *   UI now purely operates on metadata and virtualized datasets via IPC.

---

## 3. IPC Contract Design (Renderer ↔ Main)

**Renderer to Main (`invoke` - Promise based)**
*   `api.import.start(filePath: string, config: ImportConfig): Promise<ImportMeta>`
*   `api.query.getRows(table: string, limit: number, offset: number, filters?: Filter[]): Promise<TransactionItem[]>`
*   `api.query.getAggregates(table: string): Promise<DatasetStats>`
*   `api.sampling.execute(config: SamplingConfig): Promise<SamplingResultMeta>`
*   `api.export.project(path: string): Promise<void>`
*   `api.export.excel(path: string): Promise<void>`

**Main to Renderer (`on` - Event based)**
*   `on('import:progress', (pct: number, stage: string) => void)`
*   `on('export:progress', (pct: number, stage: string) => void)`
*   `on('sampling:progress', (pct: number) => void)`

---

## 4. Worker Architecture Design

To keep the Main process (Electron) and Renderer completely unblocked:

1.  **Thread Pool:** Use `piscina` or native `worker_threads`.
2.  **Import Worker:**
    *   *Input:* File path, column mapping.
    *   *Process:* Uses `xlsx` (SheetJS) configured for streaming (`set_fs`, `stream.to_csv`), or standard NodeJS `fs.createReadStream` for CSV.
    *   *Output:* Yields chunks to Main process, or ideally, the Worker directly formats into CSV chunks and uses DuckDB `COPY FROM` directly to bypass v8 heap entirely.
3.  **Export Worker:**
    *   *Input:* DuckDB Parquet path, Query, Output Path.
    *   *Process:* Uses `exceljs` streaming (`stream.xlsx.WorkbookWriter`). Consumes data iteratively via DuckDB stream.

---

## 5. DuckDB Integration Strategy

*   **Setup:** Use the `duckdb` native node package. Must be rebuilt against the Electron ABI using `electron-rebuild`.
*   **Storage:** 
    *   When a project is created, create a local folder (e.g., `AppData/AuditSamplePro/Projects/[UUID]`).
    *   Use DuckDB to ingest raw data directly into the `.parquet` format for persistent, highly-compressed storage.
    *   `CREATE VIEW current_population AS SELECT * FROM read_parquet('uuid/data.parquet')`.
*   **Memory Limit:** Configure DuckDB PRAGMAs: `PRAGMA memory_limit='1GB'; PRAGMA threads=4;` to ensure it never crashes the host machine.

---

## 6. Data Flow Diagrams

**Import Flow:**
```text
UI (File Selected) -> IPC `import.start` 
  -> Main Process Orchestrator 
    -> Spawns Worker(filePath) 
      -> Worker chunks CSV/XLSX 
      -> DuckDB copies to Parquet directly (`COPY table FROM stream`) 
    <- Worker sends progress via IPC (`import:progress`)
<- UI completes, calls `query.getRows(limit: 100)` to render preview.
```

**Processing / Sampling Flow:**
```text
UI (Run Sampling) -> IPC `sampling.execute(config)`
  -> Main Process (SamplingService)
    -> Translates Config (MUS/CVS) into SQL parameters
    -> DuckDB Executes Sampling:
       `SELECT * FROM current_population WHERE random() < threshold ...`
       (Using seed for reproducible PRNG)
    -> DuckDB exports sample subset to `sample_results.parquet`
  <- IPC returns metadata (Total misstatement, confidence intervals)
<- UI renders results dashboard.
```

---

## 7. Suggested Folder Structure

```
/src
  /main                 # Electron Main Process
    /core               # Orchestration & IPC Handlers
    /services           # DuckDB, Import, Export, Sampling Services
    /workers            # Node Worker thread scripts
  /preload              # IPC ContextBridge (Security)
  /renderer             # React Frontend (Your existing src/*)
    /adapters           # IPC Data Fetching hooks (useVirtualList)
    /components         # Existing UI (Minimally modified)
    /contexts           # Modified StorageContext -> IPC routing
```

---

## 8. TypeScript Interfaces Core Services

```typescript
// /src/main/services/IDatabaseService.ts
export interface IDatabaseService {
  initialize(projectId: string): Promise<void>;
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string): Promise<void>;
  close(): Promise<void>;
}

// /src/main/services/IImportService.ts
export interface IImportService {
  importFile(
    filePath: string, 
    mapping: ColumnIndices, 
    onProgress: (pct: number) => void
  ): Promise<ImportMetadata>;
}

// /src/main/services/ISamplingService.ts
export interface ISamplingService {
  runMUS(config: SamplingConfig, popTable: string): Promise<SamplingResult>;
  runCVS(config: SamplingConfig, popTable: string): Promise<SamplingResult>;
}
```

---

## 9. Risk Analysis

1.  **Native Module Compilation:** Integrating DuckDB with Electron often requires rigid ABI matching (`node-gyp` rebuilds). *Mitigation: Standardize node versions and setup CI/CD rebuilds immediately.*
2.  **Streaming SheetJS (XLSX):** SheetJS Community Edition has varying stream stability based on the internal XLSX tree. *Mitigation: Extract to CSV stream first physically inside a worker, then ingest CSV into DuckDB (which is 100x faster).*
3.  **UI Data Freezes mapping 1M rows:** Even via IPC, sending 100,000 rows over JSON crashes standard IPC bridges. *Mitigation: Enforce hard limit payloads (e.g. 500 rows/page) via IPC. UI MUST virtualize.*

---

## 10. Backward Compatibility Strategy

*   **Project Files (`.audsmpl`):** Provide a `LegacyMigrationService` on boot. If the user loads an old JSON-based `.audsmpl` file, the app automatically inserts it into the new DuckDB format and packages it into the new `.audsmpl` (which is now a zip containing `metadata.json` and `data.parquet`).
*   **State Signatures:** React components relying on `TransactionItem[]` will receive objects with the exact same keys (id, date, amount) hydrated directly from DuckDB.

---

## 11. Minimal-Change Refactoring Approach (React Layer)

1.  Leave `App.tsx` and `ResultsStep.tsx` layout completely intact.
2.  In `StorageContext.tsx`, replace `setPopulation(data)` with `ipcRenderer.invoke('import:start', filepath)`.
3.  In components displaying tables, replace `population.map(row => ...)` with a custom hook:
    `const { visibleRows } = useVirtualPopulation(pageLimit, offset);`
    This isolates the frontend change to exactly one layer deeply behind the existing table displays, leaving the JSX and CSS strictly untouched.

---

## 12. Performance Optimization Strategy

*   **Columnar Storage:** By moving from JSON arrays to Parquet, computing aggregates (e.g., `SUM(amount)`) will scan only the `amount` column, completing in milliseconds rather than iterating JavaScript objects.
*   **Zero-Copy Execution:** Worker threads parse the file and tell DuckDB `COPY FROM 'temp.csv'`. Data never passes through standard V8 JSON parsers, preventing OutOfMemory errors completely.
*   **SQL-Based Sampling:** MUS intervals (Cumulative Book Value thresholds) can be executed using SQL Window functions (`SUM(amount) OVER (ORDER BY id)`), eliminating the need for single-threaded loop execution in JavaScript.
