import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: "#fdcb40",
          borderRadius: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: "serif",
            fontWeight: 900,
            fontSize: 110,
            color: "#000",
            lineHeight: 1,
            marginTop: 8,
          }}
        >
          R
        </span>
      </div>
    ),
    { ...size },
  );
}
