import type { UppyFile } from "@uppy/core";
interface UploadMetadata {
    name: string;
    size: number;
    contentType: string;
}
interface UploadResponse {
    uploadURL: string;
    objectPath: string;
    metadata: UploadMetadata;
}
interface UseUploadOptions {
    /** Base path where object storage routes are mounted (default: "/api/storage") */
    basePath?: string;
    onSuccess?: (response: UploadResponse) => void;
    onError?: (error: Error) => void;
}
/**
 * React hook for handling file uploads with presigned URLs.
 *
 * This hook implements the two-step presigned URL upload flow:
 * 1. Request a presigned URL from your backend (sends JSON metadata, NOT the file)
 * 2. Upload the file directly to the presigned URL
 *
 * @example
 * ```tsx
 * function FileUploader() {
 *   const { uploadFile, isUploading, error } = useUpload({
 *     onSuccess: (response) => {
 *       console.log("Uploaded to:", response.objectPath);
 *     },
 *   });
 *
 *   const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
 *     const file = e.target.files?.[0];
 *     if (file) {
 *       await uploadFile(file);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <input type="file" onChange={handleFileChange} disabled={isUploading} />
 *       {isUploading && <p>Uploading...</p>}
 *       {error && <p>Error: {error.message}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export declare function useUpload(options?: UseUploadOptions): {
    uploadFile: (file: File) => Promise<UploadResponse | null>;
    getUploadParameters: (file: UppyFile<Record<string, unknown>, Record<string, unknown>>) => Promise<{
        method: "PUT";
        url: string;
        headers?: Record<string, string>;
    }>;
    isUploading: boolean;
    error: Error | null;
    progress: number;
};
export {};
//# sourceMappingURL=use-upload.d.ts.map