import { useState, useEffect, useCallback, useRef } from 'react';
import { TransactionItem } from '../types';
import { isElectron } from '../utils/isElectron';

export function usePopulationAdapter(initialData: TransactionItem[] = []) {
  const populationRef = useRef<TransactionItem[]>(initialData);
  const [isVirtual, setIsVirtual] = useState(false);
  const [totalRowCount, setTotalRowCount] = useState<number>(0);
  const [totalPopValue, setTotalPopValue] = useState<number>(0);

  useEffect(() => {
    if (isElectron() && window.api && window.api.query) {
      setIsVirtual(true);
    }
  }, []);

  const loadData = useCallback(async (data: TransactionItem[]) => {
    populationRef.current = data;
    setTotalRowCount(data.length);
    setTotalPopValue(data.reduce((acc, i) => acc + Math.abs(i.amount), 0));
  }, []);

  const clearData = useCallback(() => {
    populationRef.current = [];
    setTotalRowCount(0);
    setTotalPopValue(0);
  }, []);

  const fetchPage = useCallback(async (limit: number, offset: number) => {
    if (isElectron() && isVirtual && window.api) {
      const rows = await window.api.query.getRows('population', limit, offset);
      return rows;
    } else {
      return populationRef.current.slice(offset, offset + limit);
    }
  }, [isVirtual]);

  const refreshStats = useCallback(async () => {
    if (isElectron() && isVirtual && window.api) {
      try {
        const stats = await window.api.query.getAggregates('population');
        setTotalRowCount(stats.rowCount);
        setTotalPopValue(stats.totalAmount);
      } catch (e) {
        console.error("Failed to load virtual stats", e);
      }
    }
  }, [isVirtual]);

  const getFullPopulation = useCallback(() => {
    return isVirtual ? [] : populationRef.current;
  }, [isVirtual]);

  return {
    getFullPopulation,
    setPopulation: loadData,
    clearData,
    fetchPage,
    refreshStats,
    totalRowCount,
    totalPopValue,
    isVirtual
  };
}


