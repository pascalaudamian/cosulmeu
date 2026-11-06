import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './auth/AuthProvider.js';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <AuthProvider><App /></AuthProvider>
);
