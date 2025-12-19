import type { AppProps } from 'next/app';
import { Inter } from 'next/font/google';

import { AuthProvider } from '../lib/auth';
import '../styles/globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <div className={`${inter.variable} font-sans`}>
        <Component {...pageProps} />
      </div>
    </AuthProvider>
  );
}
