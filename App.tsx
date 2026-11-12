/**
 * OfertasApp
 *
 * @format
 */

import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FlowScreen } from './src/screens/FlowScreen';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <FlowScreen />
    </SafeAreaProvider>
  );
}

export default App;
