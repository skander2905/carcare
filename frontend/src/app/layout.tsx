import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryProvider } from '@/components/providers/query-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { env } from '@/lib/env';
import './globals.css';

const geistSans = Geist({ variable: '--font-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: `${env.appName} — know what your car really costs`,
    template: `%s · ${env.appName}`,
  },
  description:
    'Track fuel, maintenance, expenses and documents for your vehicles, and see the true cost per kilometre.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // suppressHydrationWarning is required: next-themes sets the theme class on
    // <html> before React hydrates, which is otherwise reported as a mismatch.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <QueryProvider>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
            <Toaster richColors closeButton position="top-right" />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
