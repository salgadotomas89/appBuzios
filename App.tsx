/**
 * OfertasApp
 *
 * @format
 */

import { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { checkInsforgeConnection } from './src/lib/insforge';
import { HomeScreen } from './src/screens/HomeScreen';

function App() {
  useEffect(() => {
    if (__DEV__) {
      checkInsforgeConnection()
        .then(ok => console.log(`InsForge: ${ok ? 'conectado' : 'sin conexión'}`))
        .catch(() => console.log('InsForge: sin conexión'));
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <HomeScreen />
    </SafeAreaProvider>
  );
}

export default App;
