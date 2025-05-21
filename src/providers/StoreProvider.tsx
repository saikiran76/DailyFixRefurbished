import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { store, persistor } from '@/store/store';
import LavaLamp from '@/components/ui/Loader/LavaLamp';

interface StoreProviderProps {
  children: ReactNode;
}

const StoreProvider = ({ children }: StoreProviderProps) => {
  return (
    <Provider store={store}>
      <PersistGate loading={<LavaLamp />} persistor={persistor}>
        {children}
      </PersistGate>
    </Provider>
  );
};

export default StoreProvider; 