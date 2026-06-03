import { Loader2 } from "lucide-react";

export function PageLoader({ text }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      {text && (
        <p className="text-sm text-muted-foreground">{text}</p>
      )}
    </div>
  );
}
