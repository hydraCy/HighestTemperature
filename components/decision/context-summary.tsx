import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ContextSummary(props: {
  title: string;
  summary: string;
  warningText?: string;
  settledText?: string;
  shortTermTrackLabel?: string;
  shortTermTrackValue?: string | null;
  shortTermTrackNote?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>{props.summary}</p>
        {props.shortTermTrackValue ? (
          <div className="rounded border border-border/60 p-2 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">{props.shortTermTrackLabel}:</span>{' '}
              {props.shortTermTrackValue}
            </p>
            {props.shortTermTrackNote ? <p className="mt-1">{props.shortTermTrackNote}</p> : null}
          </div>
        ) : null}
        {props.warningText ? (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-300">
            {props.warningText}
          </div>
        ) : null}
        {props.settledText ? (
          <div className="flex items-center gap-2 rounded border border-rose-500/30 bg-rose-500/10 p-2 text-rose-300">
            <Badge variant="destructive">PASS</Badge>
            <p>{props.settledText}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
