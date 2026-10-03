import { useState, type ReactNode } from "react";

import { RenderErrorBoundary } from "~/components/RenderErrorBoundary";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";

/**
 * Contains a crashing panel body so the chat view and other panels keep
 * working. It resets when the scoped resource changes (another environment,
 * thread or surface) and on Retry. A failed chunk load stays failed until the
 * app's chunk reload guard reloads the page, since lazy() caches the result.
 */
export function PanelErrorBoundary({
  resourceKey,
  title,
  children,
}: {
  resourceKey: string;
  title: string;
  children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <RenderErrorBoundary
      resetKeys={[resourceKey, attempt]}
      fallback={
        <Empty className="min-h-0 justify-center-safe">
          <EmptyHeader>
            <EmptyTitle>{title} stopped working</EmptyTitle>
            <EmptyDescription>The rest of T3 Code is unaffected.</EmptyDescription>
          </EmptyHeader>
          <Button size="sm" variant="outline" onClick={() => setAttempt((count) => count + 1)}>
            Retry
          </Button>
        </Empty>
      }
    >
      {children}
    </RenderErrorBoundary>
  );
}
