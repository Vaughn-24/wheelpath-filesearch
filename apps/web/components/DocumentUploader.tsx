import { useState } from 'react';

import { useAuth } from '../lib/auth';
import { isDemoMode } from '../lib/firebase';

// Cost protection: upload timeout (File Search indexing can take up to 2 min)
const UPLOAD_TIMEOUT_MS = 150000; // 2.5 minutes

export default function DocumentUploader() {
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [demoUploaded, setDemoUploaded] = useState(false);
  const { user, loading, isDemo } = useAuth();

  const processFile = async (file: File) => {
    if (!user) return;
    setUploading(true);

    // In demo mode, simulate upload
    if (isDemo || isDemoMode) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setUploading(false);
      setDemoUploaded(true);
      setTimeout(() => setDemoUploaded(false), 3000);
      return;
    }

    try {
      const token = await user.getIdToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

      // Use FormData for multipart upload directly to File Search
      const formData = new FormData();
      formData.append('file', file);

      // AbortController for upload timeout (File Search indexing takes time)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

      const res = await fetch(`${apiUrl}/documents/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          // Note: Don't set Content-Type header - browser sets it with boundary
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `Upload failed: ${res.status}`);
      }

      const result = await res.json();
      console.log('Document uploaded:', result.document?.title);
      
      // Trigger a refresh of the document list
      window.dispatchEvent(new CustomEvent('document-uploaded'));
    } catch (err) {
      console.error(err);
      let message = 'Upload failed';
      if (err instanceof Error) {
        message = err.name === 'AbortError' 
          ? 'Upload timed out. The file may still be processing - check back in a moment.'
          : err.message;
      }
      alert(message);
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      processFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!uploading && user) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (uploading || !user) return;

    if (e.dataTransfer.files?.[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <label
      htmlFor="file-upload"
      className={`block rounded-md p-lg text-center transition-all duration-base relative
            border-2 border-dashed cursor-pointer
            ${
              demoUploaded
                ? 'border-success bg-success/10'
                : isDragging
                  ? 'border-terracotta bg-terracotta-light'
                  : 'border-border hover:border-terracotta hover:bg-terracotta-light/50'
            }
            ${!user || uploading ? 'opacity-50 cursor-not-allowed' : ''}
            lg:min-h-0 min-h-[200px] lg:py-lg flex flex-col items-center justify-center
        `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        id="file-upload"
        type="file"
        className="hidden"
        accept=".pdf"
        onChange={handleFileChange}
        disabled={uploading || !user}
      />

      {/* Icon - smaller on desktop */}
      <div
        className={`p-md lg:p-sm rounded-md transition-all duration-base ${
          demoUploaded
            ? 'bg-success text-white'
            : isDragging
              ? 'bg-terracotta text-white'
              : 'bg-terracotta-light text-terracotta'
        }`}
      >
        {uploading ? (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="animate-spin lg:w-5 lg:h-5"
          >
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
        ) : demoUploaded ? (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="lg:w-5 lg:h-5"
          >
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
        ) : (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="lg:w-5 lg:h-5"
          >
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
          </svg>
        )}
      </div>

      {/* Text - more compact on desktop */}
      <div className="mt-md lg:mt-sm">
        <h3 className="text-body lg:text-body-sm font-medium text-foreground">
          {uploading
            ? 'Uploading...'
            : demoUploaded
              ? 'Uploaded!'
              : loading
                ? 'Connecting...'
                : 'Add Source'}
        </h3>
        <p className="text-body-sm lg:text-caption text-foreground-muted mt-xs lg:hidden">
          Drag & drop PDF or click to browse
        </p>
        <p className="text-caption text-foreground-subtle mt-xs hidden lg:block">
          Drop PDF or click
        </p>
      </div>
    </label>
  );
}
