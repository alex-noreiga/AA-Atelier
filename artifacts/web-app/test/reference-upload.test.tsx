import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReferenceUpload } from "@/components/reference-upload";

// The component uploads directly to Vercel Blob; mock the SDK so the test drives
// the browser flow (pick file → upload → lift URL) without any network/token.
vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));
import { upload } from "@vercel/blob/client";

const mockUpload = vi.mocked(upload);

describe("ReferenceUpload", () => {
  it("uploads a picked file to Blob and lifts the URL to onChange", async () => {
    mockUpload.mockResolvedValue({
      url: "https://x.blob.vercel-storage.com/order-references/a.png",
    } as never);
    const onChange = vi.fn();
    render(<ReferenceUpload value={[]} onChange={onChange} />);

    const input = screen.getByTestId("input-reference-files");
    const file = new File(["hi"], "a.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    expect(mockUpload).toHaveBeenCalledWith(
      "order-references/a.png",
      file,
      expect.objectContaining({
        access: "public",
        handleUploadUrl: "/api/uploads/order-refs",
      }),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        {
          name: "a.png",
          url: "https://x.blob.vercel-storage.com/order-references/a.png",
        },
      ]),
    );
  });

  it("lists existing references and removes one on click", async () => {
    const onChange = vi.fn();
    render(
      <ReferenceUpload
        value={[{ name: "sketch.png", url: "https://x/sketch.png" }]}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("sketch.png")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-remove-reference"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
