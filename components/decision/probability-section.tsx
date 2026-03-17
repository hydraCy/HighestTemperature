import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type ProbabilityRow = {
  label: string;
  modelProbability: number;
  marketPriceYes: number;
  marketPriceNo: number;
  edge: number;
  preferredSide: 'YES' | 'NO' | 'SKIP' | '-';
};

export function ProbabilitySection(props: {
  title: string;
  headers: {
    bin: string;
    modelYes: string;
    marketPriceYes: string;
    marketPriceNo: string;
    edge: string;
    preferredSide: string;
  };
  rows: ProbabilityRow[];
}) {
  const maxProb = props.rows.reduce((acc, row) => Math.max(acc, row.modelProbability), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left">{props.headers.bin}</th>
              <th className="text-left">{props.headers.modelYes}</th>
              <th className="text-left">{props.headers.marketPriceYes}</th>
              <th className="text-left">{props.headers.marketPriceNo}</th>
              <th className="text-left">{props.headers.edge}</th>
              <th className="text-left">{props.headers.preferredSide}</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.label} className={`border-t border-border/60 ${row.modelProbability === maxProb ? 'bg-primary/10' : ''}`}>
                <td className={row.modelProbability === maxProb ? 'font-semibold' : ''}>{row.label}</td>
                <td>{(row.modelProbability * 100).toFixed(1)}%</td>
                <td>{(row.marketPriceYes * 100).toFixed(1)}%</td>
                <td>{(row.marketPriceNo * 100).toFixed(1)}%</td>
                <td className={row.edge >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{row.edge.toFixed(3)}</td>
                <td className={row.preferredSide === 'YES' ? 'text-emerald-400' : row.preferredSide === 'NO' ? 'text-rose-300' : 'text-muted-foreground'}>
                  {row.preferredSide}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
