#!/usr/bin/env python3
"""
Generate a QR code for Leo Messi's Instagram profile.
Saves the QR code as 'messi_instagram.png' in the current directory.
"""

import qrcode

def generate_instagram_qr():
    """Generate a QR code for the Instagram URL."""

    # Instagram URL for Leo Messi
    instagram_url = "https://www.instagram.com/leomessi"

    # Create QR code instance with proper sizing for readability
    qr = qrcode.QRCode(
        version=1,              # Controls the size of the QR code (1-40, where 1 is 21x21 pixels)
        error_correction=qrcode.constants.ERROR_CORRECT_H,  # High error correction level
        box_size=10,            # Size of each box in pixels (makes it readable)
        border=4,               # Border thickness in boxes (minimum is 4 for QR code spec)
    )

    # Add data to the QR code
    qr.add_data(instagram_url)
    qr.make(fit=True)

    # Create an image with white background and black foreground
    image = qr.make_image(fill_color="black", back_color="white")

    # Save the image
    filename = "messi_instagram.png"
    image.save(filename)

    print(f"✓ QR code generated successfully!")
    print(f"✓ Saved as: {filename}")
    print(f"✓ Size: {image.size[0]}x{image.size[1]} pixels")
    print(f"✓ URL encoded: {instagram_url}")

if __name__ == "__main__":
    generate_instagram_qr()
