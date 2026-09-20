import Link from 'next/link';
import { type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface AuthFormShellProps {
  title: string;
  description: string;
  children: ReactNode;
  footerPrompt: string;
  footerHref: string;
  footerLabel: string;
}

/** The chrome both auth screens share, so they cannot drift apart visually. */
export function AuthFormShell({
  title,
  description,
  children,
  footerPrompt,
  footerHref,
  footerLabel,
}: AuthFormShellProps) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {children}

        <p className="text-muted-foreground text-center text-sm">
          {footerPrompt}{' '}
          <Link href={footerHref} className="text-foreground font-medium underline underline-offset-4">
            {footerLabel}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
