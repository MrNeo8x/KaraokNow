import type { Metadata } from 'next';
import './tailwind.css';
import './globals.css';
import './landing.css';
import './venue-actions.css';
import './fixed-room-images.css';
export const metadata: Metadata = { title: 'KaraokeNow', description: 'Nền tảng quản lý và đặt phòng karaoke.' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="vi"><body>{children}</body></html>; }
