import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardView } from "../../src/web/cards/CardView";
import { Providers } from "../../src/web/providers";
import { makeCard } from "./cardFixtures";
import { mockApi, staffUser } from "./mockApi";

vi.mock("../../src/web/cards/resizePhoto", () => ({
  resizePhoto: vi.fn(async (f: File) => ({ photo: f, thumb: new Blob(["t"], { type: "image/jpeg" }) })),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const photo = (id: number) => ({ id, name: `91488 Install 2026-11-12 10-0${id}.jpg`, link: `https://drive.google.com/file/d/f${id}/view`, thumbUrl: `/api/cards/7/photos/${id}/thumb` });
const installer = () => makeCard({ roleId: "installer", nextRoleId: null, step: 0, earlier: [] });

function show(extra: Record<string, (u: URL, init?: RequestInit) => unknown>) {
  const api = mockApi({
    "GET /api/auth/me": () => staffUser,
    "POST /api/cards/7/seen": () => ({ ok: true }),
    ...extra,
  });
  render(
    <MemoryRouter>
      <Providers>
        <CardView card={installer()} onClose={() => undefined} />
      </Providers>
    </MemoryRouter>,
  );
  return api;
}

const file = () => new File([new Uint8Array([0xff, 0xd8])], "IMG_0001.jpg", { type: "image/jpeg" });

describe("installer photos", () => {
  it("takes a photo, uploads it and shows its thumbnail linking to Drive", async () => {
    let photos: ReturnType<typeof photo>[] = [];
    const { calls } = show({
      "GET /api/cards/7/photos": () => ({ photos, folderLink: null }),
      "POST /api/cards/7/photos": () => {
        photos = [photo(1)];
        return { photos, folderLink: "https://drive.google.com/drive/folders/x" };
      },
    });
    const input = await screen.findByLabelText("Take photo");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");
    await userEvent.upload(input, file());
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.pathname === "/api/cards/7/photos")).toBe(true));
    const body = calls.find((c) => c.method === "POST" && c.url.pathname === "/api/cards/7/photos")!.body as FormData;
    expect(body.get("photo")).toBeInstanceOf(File);
    expect(body.get("thumb")).toBeInstanceOf(Blob);
    const link = await screen.findByRole("link", { name: /Photo 1/ });
    expect(link).toHaveAttribute("href", "https://drive.google.com/file/d/f1/view");
    expect(link.querySelector("img")).toHaveAttribute("src", "/api/cards/7/photos/1/thumb");
    expect(screen.getByText("Photos (1)")).toBeInTheDocument();
  });

  it("a failed upload can be retried without taking the photo again", async () => {
    let attempts = 0;
    const { calls } = show({
      "GET /api/cards/7/photos": () => ({ photos: [], folderLink: null }),
      "POST /api/cards/7/photos": () => {
        attempts++;
        return attempts === 1 ? Response.json({ error: "Upload failed. Try again." }, { status: 502 }) : { photos: [photo(2)], folderLink: null };
      },
    });
    await userEvent.upload(await screen.findByLabelText("Take photo"), file());
    expect(await screen.findByText("Upload failed. Try again.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("link", { name: /Photo 1/ });
    expect(calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/cards/7/photos")).toHaveLength(2);
    expect(screen.queryByText("Upload failed. Try again.")).toBeNull();
  });

  it("removes a photo after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { calls } = show({
      "GET /api/cards/7/photos": () => ({ photos: [photo(3)], folderLink: null }),
      "DELETE /api/cards/7/photos/3": () => ({ photos: [], folderLink: null }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Remove photo 1" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("link", { name: /Photo 1/ })).toBeNull());
  });
});
