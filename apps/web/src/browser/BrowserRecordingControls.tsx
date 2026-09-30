import { PreviewCaptureButton } from "~/components/preview/PreviewCaptureButton";
import { toastManager } from "~/components/ui/toast";
import { stopBrowserRecording, useActiveBrowserRecordingTabIds } from "./browserRecording";
import { showBrowserRecordingSavedToast } from "./browserRecordingToast";

export function BrowserRecordingControls() {
  const tabIds = useActiveBrowserRecordingTabIds();
  if (!tabIds.size) return null;
  return (
    <div className="fixed right-3 top-3 z-[100] flex gap-1 rounded-md border bg-background p-1 shadow-md">
      {[...tabIds].map((tabId) => (
        <PreviewCaptureButton
          key={tabId}
          recording
          onCapture={() => {
            void stopBrowserRecording(tabId).then(
              (artifact) => {
                if (artifact) showBrowserRecordingSavedToast(artifact);
              },
              (error) => {
                toastManager.add({
                  type: "error",
                  title: "Unable to stop recording",
                  description: error instanceof Error ? error.message : "An error occurred.",
                });
              },
            );
          }}
        />
      ))}
    </div>
  );
}
