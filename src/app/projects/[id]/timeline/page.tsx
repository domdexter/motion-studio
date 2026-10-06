import { Suspense } from "react";
import { TimelinePage } from "@/components/studio/timeline/timeline-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <TimelinePage projectId={id} />
    </Suspense>
  );
}
