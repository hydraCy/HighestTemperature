import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

type Lang = 'zh' | 'en';

export function SiteShell({
  children,
  currentPath,
  lang = 'zh'
}: {
  children: React.ReactNode;
  currentPath: string;
  lang?: Lang;
}) {
  const zhActive = lang !== 'en';
  const t =
    lang === 'en'
      ? {
          title: 'Polymarket Shanghai Highest Temperature Research & Decision Platform',
          subtitle: 'Decision support only, no auto-trading'
        }
      : {
          title: 'Polymarket Shanghai 最高温研究与交易决策平台',
          subtitle: '只做交易建议，不自动下单'
        };
  const path = currentPath || '/';

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{t.title}</p>
            <p className="text-xs text-muted-foreground">{t.subtitle}</p>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border/70 p-1">
            <Link
              href={`${path}?lang=zh`}
              className={cn('rounded px-3 py-1.5 text-sm', zhActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
            >
              中文
            </Link>
            <Link
              href={`${path}?lang=en`}
              className={cn('rounded px-3 py-1.5 text-sm', !zhActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
            >
              EN
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}
