import { useState, useEffect, useCallback } from 'react';
import { TransactionItem } from '../types';

export function usePopulationAdapter(initialData: TransactionItem[] = []) {
  const [population, setPopulation] = useState<TransactionItem[]>(initialData);
  const [isVirtual, setIsVirtual] = useState(false);
  const [totalRowCount, setTotalRowCount] = useState<number>(0);
  const [totalPopValue, setTotalPopValue] = useState<number>(0);

  useEffect(() => {
    if (window.api && window.api.query) {
      setIsVirtual(true);
    }
  }, []);

  const loadData = useCallback(async (data: TransactionItem[]) => {
    setPopulation(data);
    setTotalRowCount(data.length);
    setTotalPopValue(data.reduce((acc, i) => acc + Math.abs(i.amount), 0));
  }, []);

  const clearData = useCallback(() => {
    setPopulation([]);
    setTotalRowCount(0);
    setTotalPopValue(0);
  }, []);

  const fetchPage = useCallback(async (limit: number, offset: number) => {
    if (isVirtual && window.api) {
      const rows = await window.api.query.getRows('population', limit, offset);
      return rows;
    } else {
      return population.slice(offset, offset + limit);
    }
  }, [isVirtual, population]);

  const refreshStats = useCallback(async () => {
    if (isVirtual && window.api) {
      try {
        const stats = await window.api.query.getAggregates('population');
        setTotalRowCount(stats.rowCount);
        setTotalPopValue(stats.totalAmount);
      } catch (e) {
        console.error("Failed to load virtual stats", e);
      }
    }
  }, [isVirtual]);

  return {
    population, // Legacy full array
    setPopulation: loadData,
    clearData,
    fetchPage,
    refreshStats,
    totalRowCount,
    totalPopValue,
    isVirtual
  };
}


