import { useState } from 'react';
import { useAuth } from '../lib/auth';

export default function DocumentUploader() {
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const { user, loading } = useAuth();

  const processFile = async (file: File) => {
    if (!user) return;
    setUploading(true);

    try {
      const token = await user.getIdToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      
      const res = await fetch(`${apiUrl}/documents/upload-url`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      
      if (!res.ok) throw new Error('Failed to get upload URL');
      
      const { uploadUrl } = await res.json();

      await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      // Success: Reset state (DocumentList will update automatically)
    } catch (err) {
      console.error(err);
      alert('Upload failed');
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
        className={`bento-card h-full flex flex-col justify-center items-center text-center space-y-4 min-h-[200px] border-2 border-dashed transition-all duration-200 relative block
            ${isDragging ? 'border-black bg-gray-50 scale-[1.02]' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'}
            ${(!user || uploading) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
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
      
      <div className={`p-4 rounded-full text-2xl transition-colors ${isDragging ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'}`}>
        {uploading ? '⏳' : '📥'}
      </div>
      
      <div>
        <h3 className="text-lg font-medium text-gray-900">
            {uploading ? 'Uploading...' : loading ? 'Initializing...' : 'Add Source'}
        </h3>
        <p className="text-sm text-gray-500 mt-1">
            {loading ? 'Connecting to secure storage...' : 'Click or drag PDF here'}
        </p>
      </div>
    </label>
  );
}
