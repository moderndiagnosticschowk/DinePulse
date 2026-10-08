import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'DinePulse — Restaurant POS',
    template: '%s | DinePulse',
  },
  description: 'Professional restaurant POS, billing, kitchen and inventory operations.',
  applicationName: 'DinePulse',
  keywords: ['restaurant POS', 'billing', 'KOT', 'inventory', 'restaurant management'],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}