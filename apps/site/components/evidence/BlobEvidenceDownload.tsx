'use client';

import React, {useEffect, useState} from 'react';
import s from './evidence.module.css';

type BlobEvidenceDownloadProps = {
  /** A local JSON-serializable object. A new identity starts a new download. */
  report: object;
  filename: string;
  onDownload?: React.MouseEventHandler<HTMLAnchorElement>;
};

type DownloadResource = {
  report: object;
  url: string | null;
};

/** A complete local file without a multi-megabyte data URI. No upload or request. */
export default function BlobEvidenceDownload({report, filename, onDownload}: BlobEvidenceDownloadProps) {
  const [resource, setResource] = useState<DownloadResource | null>(null);

  useEffect(() => {
    let url: string | null = null;
    // Defer serialization until after rendering, and cancel it if the report changes.
    const prepare = setTimeout(() => {
      try {
        const json = JSON.stringify(report, null, 2);
        if (json === undefined) throw new Error('Report did not serialize to JSON');
        const blob = new Blob([json], {type: 'application/json;charset=utf-8'});
        url = URL.createObjectURL(blob);
      } catch {
        url = null;
      }
      setResource({report, url});
    }, 0);

    return () => {
      clearTimeout(prepare);
      if (url) URL.revokeObjectURL(url);
    };
  }, [report]);

  // Never present the preceding report's download while a replacement is preparing.
  if (resource?.report !== report) return <p>正在准备本地 JSON…</p>;
  if (!resource.url) return <p>无法准备本地 JSON，当前证据仍可在下表查看。</p>;

  return (
    <a className={s.download} href={resource.url} download={filename} onClick={onDownload}>
      下载整理后的 JSON
    </a>
  );
}
