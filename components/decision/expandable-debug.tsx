import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type ApiStatusItem = { status?: string; reason?: string; dateLabel?: string };

export function ExpandableDebug(props: {
  title: string;
  apiStatusTitle: string;
  apiDateLabel: string;
  statusLabel: string;
  reasonLabel: string;
  apiRows: Array<{ code: string; label: string }>;
  apiStatusMap: Record<string, ApiStatusItem>;
  statusText: (status?: string) => string;
  weightTitle: string;
  sourceCol: string;
  rawCol: string;
  adjustedCol: string;
  weightCol: string;
  strictReady: boolean;
  weightBreakdown?: Array<{ source: string; raw: number; adjusted: number; weight: number }>;
  detailTitle: string;
  detailText: string;
  fusionMethodLabel: string;
  fusionMethod: string;
  resolutionNote: string;
  sourceBiasTitle: string;
  avgBiasLabel: string;
  maeLabel: string;
  samplesLabel: string;
  biasStats: Array<{
    sourceCode: string;
    _avg: { bias: number | null; absError: number | null };
    _count: { sourceCode: number };
    sourceGroup?: string;
  }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <details className="rounded border border-border/60 p-2">
          <summary className="cursor-pointer font-medium">{props.apiStatusTitle}</summary>
          <div className="mt-2 space-y-1">
            {props.apiRows.map((row) => {
              const item = props.apiStatusMap[row.code];
              return (
                <div key={row.code} className="grid grid-cols-12 gap-2">
                  <p className="col-span-3">{row.label}</p>
                  <p className="col-span-2">{props.statusLabel}: {props.statusText(item?.status)}</p>
                  <p className="col-span-3 text-muted-foreground">{props.apiDateLabel}: {item?.dateLabel ?? '-'}</p>
                  <p className="col-span-4 text-muted-foreground">{props.reasonLabel}: {item?.reason ?? '-'}</p>
                </div>
              );
            })}
          </div>
        </details>

        <details className="rounded border border-border/60 p-2">
          <summary className="cursor-pointer font-medium">{props.weightTitle}</summary>
          <div className="mt-2">
            {!props.strictReady || !props.weightBreakdown?.length ? (
              <p className="text-muted-foreground">-</p>
            ) : (
              <table className="w-full">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left">{props.sourceCol}</th>
                    <th className="text-left">{props.rawCol}</th>
                    <th className="text-left">{props.adjustedCol}</th>
                    <th className="text-left">{props.weightCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {props.weightBreakdown
                    .slice()
                    .sort((a, b) => b.weight - a.weight)
                    .map((row) => (
                      <tr key={row.source} className="border-t border-border/40">
                        <td>{row.source}</td>
                        <td>{row.raw.toFixed(1)}°C</td>
                        <td>{row.adjusted.toFixed(1)}°C</td>
                        <td>{row.weight.toFixed(1)}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </details>

        <details className="rounded border border-border/60 p-2">
          <summary className="cursor-pointer font-medium">{props.detailTitle}</summary>
          <p className="mt-2 leading-relaxed">{props.detailText || '-'}</p>
          <p className="mt-2 text-muted-foreground">{props.fusionMethodLabel}: {props.fusionMethod || '-'}</p>
          <p className="text-amber-300">{props.resolutionNote}</p>
        </details>

        <details className="rounded border border-border/60 p-2">
          <summary className="cursor-pointer font-medium">{props.sourceBiasTitle}</summary>
          <div className="mt-2 space-y-1">
            {props.biasStats.map((row) => (
              <p key={`${row.sourceCode}-${row.sourceGroup ?? 'default'}`} className="grid grid-cols-12 gap-2">
                <span className="col-span-3">{row.sourceCode}</span>
                <span className="col-span-3 text-muted-foreground">{props.avgBiasLabel}: {row._avg.bias?.toFixed(2) ?? '-'}°C</span>
                <span className="col-span-3 text-muted-foreground">{props.maeLabel}: {row._avg.absError?.toFixed(2) ?? '-'}°C</span>
                <span className="col-span-3 text-muted-foreground">{props.samplesLabel}: {row._count.sourceCode}</span>
              </p>
            ))}
            {!props.biasStats.length ? <p className="text-muted-foreground">-</p> : null}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

