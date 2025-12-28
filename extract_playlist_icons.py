#!/usr/bin/env python3
"""
Extract individual playlist icons from the combined image
"""
from PIL import Image
import os
import numpy as np

# Source image path
SOURCE_IMAGE = "/Users/santiarano/Desktop/CODING PROJECTS/standbyme/webos-app/Icons/playlist icons.png"

# Output directory
OUTPUT_DIR = "/Users/santiarano/Desktop/CODING PROJECTS/standbyme/webos-app/Icons/playlists"

# Create output directory if it doesn't exist
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Load the source image
img = Image.open(SOURCE_IMAGE).convert('RGBA')
width, height = img.size
print(f"Source image size: {width}x{height}")

# Layout: 2 rows
# Row 1: 4 icons (perfect mood, dance, its a hard life, nostalgic)
# Row 2: 3 icons (soft jazz, the ultimate skiing playlist, work drive)

# Define icons with their approximate positions
# Format: (name, col, row, total_cols_in_row)
icons = [
    # Row 1 - 4 icons
    ("perfect_mood.png", 0, 0, 4),
    ("dance.png", 1, 0, 4),
    ("its_a_hard_life.png", 2, 0, 4),
    ("nostalgic.png", 3, 0, 4),
    # Row 2 - 3 icons (centered, so we need to adjust)
    ("soft_jazz.png", 0, 1, 3),
    ("the_ultimate_skiing_playlist.png", 1, 1, 3),
    ("work_drive.png", 2, 1, 3),
]

def extract_white_icon(img):
    """Extract white icon by keeping only white/light pixels"""
    arr = np.array(img).astype(np.float32)
    
    r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
    
    # White pixels have high R, G, B values and similar to each other
    brightness = (r + g + b) / 3
    
    # Keep pixels that are bright (white) and have alpha
    is_white = (brightness > 180) & (a > 50)
    
    # Also check for near-white (gray-ish white from anti-aliasing)
    is_light = (brightness > 120) & (a > 30)
    
    keep_mask = is_white | is_light
    
    # Create new array - keep the white color but preserve alpha for anti-aliasing
    new_arr = arr.copy()
    new_arr[~keep_mask] = [0, 0, 0, 0]
    
    return Image.fromarray(new_arr.astype(np.uint8))

def trim_transparent(img, threshold=10):
    """Trim fully transparent pixels"""
    arr = np.array(img)
    alpha = arr[:, :, 3]
    
    rows_with_content = np.any(alpha > threshold, axis=1)
    cols_with_content = np.any(alpha > threshold, axis=0)
    
    row_indices = np.where(rows_with_content)[0]
    col_indices = np.where(cols_with_content)[0]
    
    if len(row_indices) == 0 or len(col_indices) == 0:
        return img
    
    return img.crop((col_indices[0], row_indices[0], col_indices[-1] + 1, row_indices[-1] + 1))

def add_padding(img, padding=10):
    """Add transparent padding around the image"""
    new_width = img.width + padding * 2
    new_height = img.height + padding * 2
    new_img = Image.new('RGBA', (new_width, new_height), (0, 0, 0, 0))
    new_img.paste(img, (padding, padding), img)
    return new_img

def make_square(img):
    """Make image square by centering in a square canvas"""
    size = max(img.width, img.height)
    square_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    offset_x = (size - img.width) // 2
    offset_y = (size - img.height) // 2
    square_img.paste(img, (offset_x, offset_y), img)
    return square_img

# Calculate row heights (2 rows)
row_height = height / 2

# For row 1, text is at about 65% down, icons are in top 55%
# For row 2, similar structure

# Extract each icon
for name, col, row, total_cols in icons:
    # Calculate cell width based on how many icons in this row
    cell_width = width / total_cols
    
    # For row 2 with 3 icons, they appear centered
    # Add offset for centering
    if total_cols == 3:
        x_offset = (width - cell_width * 3) / 2
    else:
        x_offset = 0
    
    # Calculate crop box
    left = int(x_offset + cell_width * col)
    right = int(x_offset + cell_width * (col + 1))
    top = int(row_height * row)
    bottom = int(row_height * row + row_height * 0.65)  # Take top 65% to avoid text
    
    # Crop the cell
    icon_img = img.crop((left, top, right, bottom))
    
    # Extract white icon
    icon_img = extract_white_icon(icon_img)
    
    # Trim transparent
    icon_img = trim_transparent(icon_img)
    
    # Add padding
    icon_img = add_padding(icon_img, 10)
    
    # Make square
    icon_img = make_square(icon_img)
    
    # Save
    output_path = os.path.join(OUTPUT_DIR, name)
    icon_img.save(output_path, "PNG")
    print(f"Saved: {name} ({icon_img.width}x{icon_img.height})")

# Create a music note fallback icon
print("\nCreating music note fallback icon...")
# We'll create a simple music note SVG-style icon programmatically
fallback_size = 200
fallback = Image.new('RGBA', (fallback_size, fallback_size), (0, 0, 0, 0))
# For now, just save an empty placeholder - we'll use an SVG in the code
fallback.save(os.path.join(OUTPUT_DIR, "fallback.png"), "PNG")

print("\nDone! Playlist icons extracted to:", OUTPUT_DIR)

