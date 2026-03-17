import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type MarketComparisonRow = {
  label: string;
  modelProbability: number;
  marketPriceYes: number;
  marketPriceNo: number;
  edge: number;
};

export function MarketComparison(props: {
  title: string;
  headers: {
    bin: string;
    modelProb: string;
    marketPriceYes: string;
    marketPriceNo: string;
    edge: string;
  };
  rows: MarketComparisonRow[];
}) {
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
              <th className="text-left">{props.headers.modelProb}</th>
              <th className="text-left">{props.headers.marketPriceYes}</th>
              <th className="text-left">{props.headers.marketPriceNo}</th>
              <th className="text-left">{props.headers.edge}</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.label} className="border-t border-border/60">
                <td>{row.label}</td>
                <td>{(row.modelProbability * 100).toFixed(1)}%</td>
                <td>{(row.marketPriceYes * 100).toFixed(1)}%</td>
                <td>{(row.marketPriceNo * 100).toFixed(1)}%</td>
                <td className={row.edge >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{row.edge.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
