import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Upload, X, CheckCircle, Loader2, ImageIcon } from "lucide-react";

const formSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().min(1, "Phone number is required"),
  preferredContact: z.enum(["email", "phone", "text"], {
    required_error: "Please select a preferred contact method",
  }),
  measurementUnit: z.enum(["inches", "cm"]).default("inches"),
  waist: z.coerce.number({ invalid_type_error: "Required" }).positive("Must be a positive number"),
  bust: z.coerce.number({ invalid_type_error: "Required" }).positive("Must be a positive number"),
  hips: z.coerce.number({ invalid_type_error: "Required" }).positive("Must be a positive number"),
  height: z.coerce.number({ invalid_type_error: "Required" }).positive("Must be a positive number"),
  bodyGirth: z.coerce.number({ invalid_type_error: "Required" }).positive("Must be a positive number"),
  description: z.string().optional(),
  neededBy: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface UploadedImage {
  file: File;
  preview: string;
  objectPath?: string;
  uploading: boolean;
  error?: string;
}

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

async function requestUploadUrl(file: File): Promise<{ uploadURL: string; objectPath: string }> {
  const res = await fetch(`${BASE_URL}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!res.ok) throw new Error("Failed to get upload URL");
  return res.json();
}

async function uploadFileToBucket(uploadURL: string, file: File): Promise<void> {
  const res = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error("Upload failed");
}

function buildServingUrl(objectPath: string): string {
  return `${window.location.origin}${BASE_URL}/api/storage${objectPath}`;
}

export default function OrderForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [successOrderNumber, setSuccessOrderNumber] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { measurementUnit: "inches", preferredContact: undefined },
  });

  const measurementUnit = watch("measurementUnit");
  const preferredContact = watch("preferredContact");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const remaining = 5 - images.length;
    const toAdd = files.slice(0, remaining);
    if (toAdd.length === 0) return;

    const newImages: UploadedImage[] = toAdd.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      uploading: true,
    }));
    setImages((prev) => [...prev, ...newImages]);

    for (const img of newImages) {
      try {
        const { uploadURL, objectPath } = await requestUploadUrl(img.file);
        await uploadFileToBucket(uploadURL, img.file);
        setImages((prev) =>
          prev.map((i) =>
            i.preview === img.preview ? { ...i, uploading: false, objectPath } : i
          )
        );
      } catch {
        setImages((prev) =>
          prev.map((i) =>
            i.preview === img.preview
              ? { ...i, uploading: false, error: "Upload failed" }
              : i
          )
        );
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (preview: string) => {
    setImages((prev) => prev.filter((i) => i.preview !== preview));
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const uploadedImageUrls = images
        .filter((i) => i.objectPath && !i.error)
        .map((i) => buildServingUrl(i.objectPath!));

      const payload: Record<string, unknown> = {
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
        preferredContact: values.preferredContact,
        measurementUnit: values.measurementUnit,
        waist: values.waist,
        bust: values.bust,
        hips: values.hips,
        height: values.height,
        bodyGirth: values.bodyGirth,
        imageUrls: uploadedImageUrls,
      };
      if (values.description) payload.description = values.description;
      if (values.neededBy) payload.neededBy = values.neededBy;

      const res = await fetch(`${BASE_URL}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Submission failed");
      }

      const data = await res.json();
      setSuccessOrderNumber(data.orderNumber);
    } catch (err) {
      alert((err as Error).message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (successOrderNumber) {
    return (
      <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center p-6 bg-background">
        <div className="w-full max-w-lg text-center animate-in fade-in zoom-in-95 duration-700">
          <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" strokeWidth={1} />
          <h1 className="text-3xl font-serif mb-3">Order Received</h1>
          <p className="text-muted-foreground font-light mb-8">
            Thank you! We'll be in touch soon to confirm your details.
          </p>
          <div className="border border-border rounded-lg p-6 mb-8 inline-block">
            <p className="text-xs tracking-[0.15em] uppercase text-muted-foreground mb-1">Your order number</p>
            <p className="text-2xl font-mono font-medium text-primary tracking-widest">{successOrderNumber}</p>
          </div>
          <p className="text-sm text-muted-foreground mb-8">
            Save this number — you can use it to track your order status at any time.
          </p>
          <a
            href={BASE_URL + "/"}
            className="inline-flex items-center gap-2 text-sm tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Track order status
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] w-full bg-background">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="mb-10">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors tracking-widest uppercase mb-8 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Track my order
          </Link>
          <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-3">Place an Order</h1>
          <p className="text-muted-foreground font-light text-lg">
            Tell us about your dream dress and we'll bring it to life.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-12">
          {/* Contact Information */}
          <section>
            <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6 pb-2 border-b border-border">
              Contact Information
            </h2>
            <div className="space-y-5">
              <div>
                <Label htmlFor="fullName" className="text-sm font-light tracking-wide">
                  Full Name <span className="text-primary">*</span>
                </Label>
                <Input
                  id="fullName"
                  {...register("fullName")}
                  placeholder="Your full name"
                  className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                />
                {errors.fullName && (
                  <p className="text-destructive text-xs mt-1">{errors.fullName.message}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <Label htmlFor="email" className="text-sm font-light tracking-wide">
                    Email <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    {...register("email")}
                    placeholder="you@example.com"
                    className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                  />
                  {errors.email && (
                    <p className="text-destructive text-xs mt-1">{errors.email.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="phone" className="text-sm font-light tracking-wide">
                    Phone Number <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    {...register("phone")}
                    placeholder="+1 (555) 000-0000"
                    className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                  />
                  {errors.phone && (
                    <p className="text-destructive text-xs mt-1">{errors.phone.message}</p>
                  )}
                </div>
              </div>

              <div>
                <Label className="text-sm font-light tracking-wide">
                  Preferred Contact Method <span className="text-primary">*</span>
                </Label>
                <div className="flex gap-3 mt-2">
                  {(["email", "phone", "text"] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setValue("preferredContact", method, { shouldValidate: true })}
                      className={`px-4 py-2 rounded-full text-xs tracking-widest uppercase border transition-all ${
                        preferredContact === method
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {method.charAt(0).toUpperCase() + method.slice(1)}
                    </button>
                  ))}
                </div>
                {errors.preferredContact && (
                  <p className="text-destructive text-xs mt-1">{errors.preferredContact.message}</p>
                )}
              </div>
            </div>
          </section>

          {/* Measurements */}
          <section>
            <div className="flex items-center justify-between mb-6 pb-2 border-b border-border">
              <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground">
                Measurements <span className="text-primary">*</span>
              </h2>
              <div className="flex gap-2">
                {(["inches", "cm"] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => setValue("measurementUnit", unit)}
                    className={`px-3 py-1 rounded-full text-xs tracking-wider border transition-all ${
                      measurementUnit === unit
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              {([
                { key: "waist", label: "Waist" },
                { key: "bust", label: "Bust" },
                { key: "hips", label: "Hips" },
                { key: "height", label: "Height" },
                { key: "bodyGirth", label: "Body Girth" },
              ] as const).map(({ key, label }) => (
                <div key={key}>
                  <Label htmlFor={key} className="text-sm font-light tracking-wide">
                    {label}
                    <span className="text-muted-foreground/60 ml-1 text-xs">({measurementUnit})</span>
                  </Label>
                  <Input
                    id={key}
                    type="number"
                    step="0.1"
                    min="0"
                    {...register(key)}
                    placeholder="0.0"
                    className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                  />
                  {errors[key] && (
                    <p className="text-destructive text-xs mt-1">{errors[key]?.message}</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Dress Details */}
          <section>
            <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6 pb-2 border-b border-border">
              Dress Details
            </h2>
            <div className="space-y-6">
              <div>
                <Label className="text-sm font-light tracking-wide mb-2 block">
                  Inspiration Images
                  <span className="text-muted-foreground/60 ml-1 text-xs">(up to 5)</span>
                </Label>

                <div className="flex flex-wrap gap-3 mb-3">
                  {images.map((img) => (
                    <div
                      key={img.preview}
                      className="relative w-20 h-20 rounded-lg overflow-hidden border border-border group"
                    >
                      <img
                        src={img.preview}
                        alt="Inspiration"
                        className="w-full h-full object-cover"
                      />
                      {img.uploading && (
                        <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        </div>
                      )}
                      {img.error && (
                        <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
                          <span className="text-destructive text-xs">!</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeImage(img.preview)}
                        className="absolute top-1 right-1 bg-background/80 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  {images.length < 5 && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-20 h-20 rounded-lg border border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                    >
                      <ImageIcon className="w-5 h-5" />
                      <span className="text-xs">Add</span>
                    </button>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />

                {images.length === 0 && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border border-dashed border-border rounded-lg py-8 flex flex-col items-center gap-2 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                  >
                    <Upload className="w-6 h-6" strokeWidth={1.5} />
                    <span className="text-sm">Click to upload inspiration images</span>
                    <span className="text-xs opacity-60">PNG, JPG, WEBP up to 10MB each</span>
                  </button>
                )}
              </div>

              <div>
                <Label htmlFor="description" className="text-sm font-light tracking-wide">
                  Description / Notes
                  <span className="text-muted-foreground/60 ml-1 text-xs">(optional)</span>
                </Label>
                <Textarea
                  id="description"
                  {...register("description")}
                  placeholder="Tell us about your vision — style, fabric preferences, special requirements..."
                  rows={4}
                  className="mt-1.5 bg-transparent border border-border rounded-lg px-3 py-2 text-sm focus-visible:ring-0 focus-visible:border-primary transition-colors resize-none shadow-none"
                />
              </div>

              <div>
                <Label htmlFor="neededBy" className="text-sm font-light tracking-wide">
                  Needed By
                  <span className="text-muted-foreground/60 ml-1 text-xs">(optional)</span>
                </Label>
                <Input
                  id="neededBy"
                  type="date"
                  {...register("neededBy")}
                  className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none w-48"
                />
              </div>
            </div>
          </section>

          {/* Submit */}
          <div className="flex justify-center pt-4 pb-8">
            <Button
              type="submit"
              disabled={submitting || images.some((i) => i.uploading)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 px-10 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 hover:shadow-[0_0_20px_rgba(209,156,151,0.2)] disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Order"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
