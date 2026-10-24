import { ClassicLauncher } from "../components/ClassicLauncher";

export function StudioPage() {
  return (
    <div className="page-grid">
      <ClassicLauncher view="studio" title="3D Studio">
        Primitives, import and export, boolean edits and the local-model edit box run in the classic window.
      </ClassicLauncher>
    </div>
  );
}
