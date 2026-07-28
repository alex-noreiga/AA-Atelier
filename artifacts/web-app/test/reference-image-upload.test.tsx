import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock only the upload transport; keep the real constants (MAX_REFERENCE_IMAGES,
// ACCEPT_ATTR) so the component's limit logic is exercised for real. Each test
// drives `uploadReferenceImage`'s resolution to steer the per-item status.
const hoisted = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/lib/reference-images", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/reference-images")>();
  return { ...actual, uploadReferenceImage: hoisted.upload };
});

import { ReferenceImageUpload } from "@/components/reference-image-upload";
import { MAX_REFERENCE_IMAGES } from "@/lib/reference-images";

function img(name: string): File {
  return new File([new Uint8Array(8)], name, { type: "image/jpeg" });
}

/** Deferred upload so a test can assert the "uploading" state before resolving. */
function deferredUpload() {
  let resolve!: (v: { id: string }) => void;
  let reject!: (e: Error) => void;
  hoisted.upload.mockReturnValueOnce(
    new Promise<{ id: string }>((res, rej) => {
      resolve = res;
      reject = rej;
    }),
  );
  return { resolve, reject };
}

beforeEach(() => {
  hoisted.upload.mockReset();
});

describe("ReferenceImageUpload", () => {
  it("uploads chosen files and reports their ids via onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    hoisted.upload
      .mockResolvedValueOnce({ id: "up-a" })
      .mockResolvedValueOnce({ id: "up-b" });

    render(<ReferenceImageUpload onChange={onChange} />);
    await user.upload(screen.getByTestId("reference-image-input"), [
      img("front.jpg"),
      img("back.jpg"),
    ]);

    // Both rows render, and once uploads settle onChange carries both ids.
    expect(screen.getAllByTestId("reference-image-item")).toHaveLength(2);
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(["up-a", "up-b"]),
    );
    expect(await screen.findAllByLabelText("Uploaded")).toHaveLength(2);
  });

  it("shows a spinner while an upload is in flight, then a check on success", async () => {
    const user = userEvent.setup();
    const { resolve } = deferredUpload();

    render(<ReferenceImageUpload onChange={vi.fn()} />);
    await user.upload(
      screen.getByTestId("reference-image-input"),
      img("wip.jpg"),
    );

    expect(await screen.findByLabelText("Uploading")).toBeInTheDocument();

    resolve({ id: "up-wip" });
    expect(await screen.findByLabelText("Uploaded")).toBeInTheDocument();
    expect(screen.queryByLabelText("Uploading")).not.toBeInTheDocument();
  });

  it("surfaces the error message and omits the id when an upload fails", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    hoisted.upload.mockRejectedValueOnce(new Error("This image is too large."));

    render(<ReferenceImageUpload onChange={onChange} />);
    await user.upload(
      screen.getByTestId("reference-image-input"),
      img("huge.jpg"),
    );

    expect(
      await screen.findByText("This image is too large."),
    ).toBeInTheDocument();
    // A failed upload contributes no id — onChange never reports a done id.
    expect(onChange.mock.calls.every(([ids]) => ids.length === 0)).toBe(true);
  });

  it("removes an item and re-emits the remaining ids", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    hoisted.upload.mockResolvedValueOnce({ id: "up-x" });

    render(<ReferenceImageUpload onChange={onChange} />);
    await user.upload(
      screen.getByTestId("reference-image-input"),
      img("remove-me.jpg"),
    );
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(["up-x"]));

    const item = screen.getByTestId("reference-image-item");
    await user.click(within(item).getByLabelText(/^Remove /));

    expect(
      screen.queryByTestId("reference-image-item"),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([]));
  });

  it("caps at MAX_REFERENCE_IMAGES and hides the add button at the limit", async () => {
    const user = userEvent.setup();
    hoisted.upload.mockResolvedValue({ id: "up" });

    render(<ReferenceImageUpload onChange={vi.fn()} />);
    // Offer one more than the cap in a single selection — the extra is dropped.
    const files = Array.from({ length: MAX_REFERENCE_IMAGES + 1 }, (_, i) =>
      img(`ref-${i}.jpg`),
    );
    await user.upload(screen.getByTestId("reference-image-input"), files);

    expect(screen.getAllByTestId("reference-image-item")).toHaveLength(
      MAX_REFERENCE_IMAGES,
    );
    expect(screen.queryByTestId("add-reference-image")).not.toBeInTheDocument();
  });

  it("ignores an empty selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ReferenceImageUpload onChange={onChange} />);
    // Firing the input with no files is a no-op: no rows, no upload attempt.
    await user.upload(screen.getByTestId("reference-image-input"), []);

    expect(
      screen.queryByTestId("reference-image-item"),
    ).not.toBeInTheDocument();
    expect(hoisted.upload).not.toHaveBeenCalled();
  });
});
