import { useState } from 'react';

import { useAuth } from '../lib/auth';
import { isDemoMode } from '../lib/firebase';

export default function DocumentUploader() {
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [demoUploaded, setDemoUploaded] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
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

      // Normalize Content-Type for PDF files
      const contentType = file.type || 'application/pdf';
      const normalizedContentType = contentType.includes('pdf') ? 'application/pdf' : contentType;

      console.log('[DocumentUploader] Requesting upload URL:', {
        filename: file.name,
        fileType: file.type,
        normalizedContentType,
        fileSize: file.size,
      });

      const res = await fetch(`${apiUrl}/documents/upload-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          filename: file.name, 
          contentType: normalizedContentType,
          fileSize: file.size,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: 'Unknown error' }));
        console.error('[DocumentUploader] Failed to get upload URL:', errorData);
        throw new Error(errorData.message || 'Failed to get upload URL');
      }

      const { uploadUrl, documentId } = await res.json();
      console.log('[DocumentUploader] Got upload URL, uploading file...', { documentId });

      // Upload file to signed URL
      // Important: Content-Type must match exactly what was used to generate the signed URL
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 
          'Content-Type': normalizedContentType,
        },
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('[DocumentUploader] Upload failed:', {
          status: uploadResponse.status,
          statusText: uploadResponse.statusText,
          error: errorText,
          contentType: normalizedContentType,
          fileSize: file.size,
        });
        throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
      }

      console.log('[DocumentUploader] ✅ File uploaded to GCS, now processing...');
      setUploading(false);
      setProcessing(true);

      // Trigger document processing (extract text, create chunks, generate embeddings)
      const processResponse = await fetch(`${apiUrl}/documents/${documentId}/process`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!processResponse.ok) {
        const errorData = await processResponse.json().catch(() => ({ message: 'Processing failed' }));
        console.error('[DocumentUploader] Processing failed:', errorData);
        // Don't throw - document is uploaded, just not processed
        // User can still see it in list, and we can retry processing later
      } else {
        const processResult = await processResponse.json();
        console.log('[DocumentUploader] ✅ Document processed:', processResult);
      }

      setProcessing(false);
      
      // Show success state
      setUploadSuccess(true);
      setTimeout(() => {
        setUploadSuccess(false);
      }, 3000);
    } catch (err) {
      console.error(err);
      alert('Upload failed');
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      processFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!uploading && !processing && user) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (uploading || processing || !user) return;

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
              uploadSuccess
                ? 'border-success bg-success/10'
                : demoUploaded
                ? 'border-success bg-success/10'
                : isDragging
                  ? 'border-terracotta bg-terracotta-light'
                  : 'border-border hover:border-terracotta hover:bg-terracotta-light/50'
            }
            ${!user || uploading || processing ? 'opacity-50 cursor-not-allowed' : ''}
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
        disabled={!!(uploading || processing || !user)}
        suppressHydrationWarning
      />

      {/* Icon - smaller on desktop */}
      <div
        className={`p-md lg:p-sm rounded-md transition-all duration-base ${
          uploadSuccess || demoUploaded
            ? 'bg-success text-white'
            : isDragging
              ? 'bg-terracotta text-white'
              : 'bg-terracotta-light text-terracotta'
        }`}
      >
        {uploading || processing ? (
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
        <h3 className="text-body lg:text-body-sm font-medium text-foreground" suppressHydrationWarning>
          {uploading
            ? 'Uploading...'
            : processing
              ? 'Processing...'
              : uploadSuccess || demoUploaded
                ? 'Ready!'
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
