export const storage = {
  init: async () => {},
  load: async <T>(key: string, defaultValue: T): Promise<T> => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) return JSON.parse(stored) as T;
    } catch (e) {
      console.error(e);
    }
    return defaultValue;
  },
  save: async <T>(key: string, value: T): Promise<void> => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(e);
    }
  }
};
