// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UploadPage } from "./UploadPage"

afterEach(cleanup)

const PDF = new File(["%PDF-1.4"], "receipt.pdf", { type: "application/pdf" })

function selectFile(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

describe("UploadPage", () => {
  it("uploads the selected file and shows the added total", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "added", receipt_id: "r1", total: "12.34", currency: "EUR" }),
    })
    render(<UploadPage />)

    selectFile(screen.getByLabelText("Receipt PDF"), PDF)
    fireEvent.click(screen.getByRole("button", { name: /upload receipt/i }))

    await waitFor(() => {
      expect(screen.getByText(/added/i)).toBeTruthy()
    })
    expect(fetch).toHaveBeenCalledWith("/api/upload", expect.objectContaining({ method: "POST" }))
  })

  it("shows a duplicate message when the receipt is already stored", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "duplicate", receipt_id: "r1" }),
    })
    render(<UploadPage />)

    selectFile(screen.getByLabelText("Receipt PDF"), PDF)
    fireEvent.click(screen.getByRole("button", { name: /upload receipt/i }))

    await waitFor(() => {
      expect(screen.getByText(/already in the store/i)).toBeTruthy()
    })
  })

  it("shows the server's error detail on a failed upload", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Only PDF files are supported." }),
    })
    render(<UploadPage />)

    selectFile(screen.getByLabelText("Receipt PDF"), PDF)
    fireEvent.click(screen.getByRole("button", { name: /upload receipt/i }))

    await waitFor(() => {
      expect(screen.getByText("Only PDF files are supported.")).toBeTruthy()
    })
  })
})
