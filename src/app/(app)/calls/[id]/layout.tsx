import type { ReactNode } from "react";
import { BottomDock } from "@/components/calls/bottom-dock";
import { RecordingProvider } from "@/components/calls/recording-provider";

type Params = Promise<{ id: string }>;

// The call's recording lives here, above the page: router.refresh() (an item ticked, a Realtime update,
// the sheet replacing the timeline) re-renders the page but never this layout, so the one <audio> element
// keeps playing. error.tsx sits inside this segment, so a page error leaves the audio playing too. Another
// call is another provider (key).

export default async function CallLayout({ children, params }: { children: ReactNode; params: Params }) {
  const { id } = await params;
  return (
    <RecordingProvider key={id} callId={id}>
      {children}
      <BottomDock />
    </RecordingProvider>
  );
}
