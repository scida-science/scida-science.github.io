import { useState } from "react";
import { usePortal } from "../state/PortalContext";
import type { Discovery, ReviewerPackage as Package, ReviewerPackageFile } from "../types";
import type { PackageDirectory } from "../lib/reviewerPackage";

const size = (bytes: number) => bytes >= 1024 ** 3
  ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

export default function ReviewerPackage({ discoveryId, kind, bundle }: {
  discoveryId: string; kind: keyof Discovery["materials"]; bundle: Package;
}) {
  const { downloadPackageFile } = usePortal();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const picker = (window as unknown as {
    showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<PackageDirectory>;
  }).showDirectoryPicker;
  async function save(files: ReviewerPackageFile[], chooseDirectory: boolean) {
    setBusy(true); setFailed(false); setMessage("");
    try {
      const directory = chooseDirectory && picker ? await picker.call(window, { mode: "readwrite" }) : undefined;
      for (let i = 0; i < files.length; i++) {
        setMessage(`Downloading ${i + 1} of ${files.length}: ${files[i].filename}`);
        const result = await downloadPackageFile(discoveryId, kind, files[i], directory);
        if (!result.ok) throw new Error(result.message);
      }
      setMessage(chooseDirectory
        ? "All package files were verified and saved. Run python assemble.py in the chosen folder."
        : "File verified and downloaded. Keep all package files together with their original filenames.");
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Download interrupted. Please try again.");
    } finally { setBusy(false); }
  }
  return <section className="reviewer-package stack" aria-label="Complete reviewer package">
    <h3>Complete analysis package</h3>
    <p>{bundle.filename} · {size(bundle.size)} compressed · {bundle.files.length} download files</p>
    <p>The package includes analysis code, required inputs, dependency specifications and a reviewer README.
      Save every file in one folder, then run <code>python assemble.py</code> there with Python 3.12.
      The helper checks the complete archive and extracts it into a new folder. Allow space for the extracted data as well as the download.</p>
    {picker ? <button type="button" className="btn btn-secondary" disabled={busy}
      onClick={() => void save(bundle.files, true)}>Save complete package to folder</button>
      : <p>Download each file below into the same folder. A browser with folder-saving support can save the complete package in one step.</p>}
    <details>
      <summary>Individual files</summary>
      <ul>{bundle.files.map(file => <li key={file.id}>
        <button type="button" className="text-button" disabled={busy}
          onClick={() => void save([file], false)}>{file.filename} ({size(file.size)})</button>
      </li>)}</ul>
    </details>
    {message && <p className={`notice${failed ? " notice-error" : ""}`} role={failed ? "alert" : "status"}>{message}</p>}
  </section>;
}
