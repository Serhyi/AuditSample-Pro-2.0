import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { storage } from '../utils/portableStorage';
import { GlobalSettings, GoogleConfig } from '../types';

interface StorageContextType {
  isReady: boolean;
  settings: GlobalSettings;
  googleConfig: GoogleConfig;
  updateSettings: (newSettings: GlobalSettings) => Promise<void>;
  updateGoogleConfig: (newConfig: GoogleConfig) => Promise<void>;
}

const defaultSettings: GlobalSettings = {
  region: 'ua',
  dateFormat: 'dd.mm.yyyy',
  numberSeparator: 'space_comma',
  language: 'ua',
  currency: 'UAH'
};

const defaultGoogleConfig: GoogleConfig = {
  clientId: '',
  apiKey: ''
};

const StorageContext = createContext<StorageContextType | null>(null);

export const StorageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isReady, setIsReady] = useState(false);
  const [settings, setSettings] = useState<GlobalSettings>(defaultSettings);
  const [googleConfig, setGoogleConfig] = useState<GoogleConfig>(defaultGoogleConfig);

  useEffect(() => {
    async function init() {
      try {
        await storage.init();
        
        const [loadedSettings, loadedGoogle] = await Promise.all([
          storage.load<GlobalSettings>('settings', defaultSettings),
          storage.load<GoogleConfig>('google_config', defaultGoogleConfig)
        ]);

        if (loadedSettings) setSettings(loadedSettings);
        if (loadedGoogle) setGoogleConfig(loadedGoogle);
      } catch (e) {
        console.error("Failed to load portable storage", e);
      } finally {
        setIsReady(true);
      }
    }
    init();
  }, []);

  const updateSettings = async (newSettings: GlobalSettings) => {
    setSettings(newSettings);
    await storage.save('settings', newSettings);
  };

  const updateGoogleConfig = async (newConfig: GoogleConfig) => {
    setGoogleConfig(newConfig);
    await storage.save('google_config', newConfig);
  };

  return (
    <StorageContext.Provider value={{ isReady, settings, googleConfig, updateSettings, updateGoogleConfig }}>
      {children}
    </StorageContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useAppStorage() {
  const context = useContext(StorageContext);
  if (!context) {
    throw new Error('useAppStorage must be used within StorageProvider');
  }
  return context;
}
