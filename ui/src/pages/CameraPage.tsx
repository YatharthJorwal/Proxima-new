import { CameraPreview } from "../components/CameraPreview";
import { ClassicLauncher } from "../components/ClassicLauncher";

export function CameraPage() {
  return (
    <div className="page-grid two">
      <CameraPreview />
      <ClassicLauncher view="camera" title="Hand tracking">
        Hand tracking and the pinch trigger run in the classic window.
      </ClassicLauncher>
    </div>
  );
}
