import { NextResponse } from "next/server";
import { generateBySquareQrImage } from "@/lib/payments/bysquare";

export async function GET() {
  try {
    const qrImageDataUrl = await generateBySquareQrImage({
      amount: 1.00,
      variableSymbol: "123456",
      note: "Test payment - Your Agency",
    });

    return NextResponse.json({ qrImageDataUrl });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate QR" },
      { status: 500 }
    );
  }
}
