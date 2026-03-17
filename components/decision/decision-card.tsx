import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type DecisionBadgeVariant = 'success' | 'warning' | 'secondary';

export function DecisionCard(props: {
  title: string;
  actionLabel: string;
  actionVariant: DecisionBadgeVariant;
  bestLabel: string;
  bestSide: string;
  edge: string;
  modelProb: string;
  marketPrice: string;
  tradeScore: string;
  warmingForecast?: string;
  reasonTitle: string;
  fullReason: string;
  labels: {
    recBin: string;
    recSide: string;
    edge: string;
    modelProb: string;
    marketPx: string;
    tradeScore: string;
    warmingForecast: string;
  };
}) {
  const { labels } = props;
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={props.actionVariant}>{props.actionLabel}</Badge>
          <span className="text-sm">
            {labels.recBin}: <span className="font-semibold">{props.bestLabel}</span>
          </span>
          <span className="text-sm">
            {labels.recSide}: <span className="font-semibold">{props.bestSide}</span>
          </span>
          <span className="text-sm">
            {labels.edge}: <span className="font-semibold">{props.edge}</span>
          </span>
        </div>
        <div className="grid gap-2 text-sm md:grid-cols-3">
          <p>{labels.modelProb}: {props.modelProb}</p>
          <p>{labels.marketPx}: {props.marketPrice}</p>
          <p>{labels.tradeScore}: {props.tradeScore}</p>
          <p className="md:col-span-3">{labels.warmingForecast}: {props.warmingForecast ?? '-'}</p>
        </div>
        <div className="rounded border border-border/60 p-2 text-xs">
          <p className="mb-1 font-medium">{props.reasonTitle}</p>
          {props.fullReason ? (
            <p className="leading-relaxed">{props.fullReason}</p>
          ) : (
            <p className="text-muted-foreground">-</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
