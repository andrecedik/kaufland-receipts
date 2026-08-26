// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { UploadPage } from "./UploadPage"

afterEach(cleanup)

function makePdf(name: string) {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" })
}

function selectFiles(input: HTMLElement, files: File[]) {
  fireEvent.change(input, { target: { files } })
}

describe("UploadPage", () => {
  it("renders a pending row for each selected file", () => {
    render(<UploadPage />)

    selectFiles(screen.getByLabelText("Receipt PDFs"), [
      makePdf("receipt-1.pdf"),
      makePdf("receipt-2.pdf"),
    ])

    expect(screen.getByText("receipt-1.pdf")).toBeTruthy()
    expect(screen.getByText("receipt-2.pdf")).toBeTruthy()
    expect(screen.getAllByText("Pending")).toHaveLength(2)
  })
})
