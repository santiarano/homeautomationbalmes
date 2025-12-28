#!/usr/bin/env python3
"""
Extract individual icons from the combined icons image
Focus on extracting the gold-colored icons and removing the gradient background
"""
from PIL import Image
import os
import numpy as np

# Source image path
SOURCE_IMAGE = "/Users/santiarano/Downloads/all icons.png"

# Output directory
OUTPUT_DIR = "/Users/santiarano/Desktop/CODING PROJECTS/standbyme/webos-app/Icons/weather"

# Create output directory if it doesn't exist
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Load the source image
img = Image.open(SOURCE_IMAGE).convert('RGBA')
width, height = img.size
print(f"Source image size: {width}x{height}")

cols = 5
rows = 2

# Calculate cell dimensions
cell_width = width / cols
cell_height = height / rows

print(f"Cell size: {cell_width}x{cell_height}")

# Define icon names and positions (col, row)
icons = [
    ("clear.png", 0, 0),
    ("partlycloudy.png", 1, 0),
    ("cloudy.png", 2, 0),
    ("rainy.png", 3, 0),
    ("pouring.png", 4, 0),
    ("snowy.png", 0, 1),
    ("foggy.png", 1, 1),
    ("windy.png", 2, 1),
    ("movie_time.png", 3, 1),
    ("end_show.png", 4, 1),
]

def extract_gold_icon(img):
    """Extract the gold icon by removing the gradient background and cleaning edges"""
    arr = np.array(img).astype(np.float32)
    
    r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
    
    # Calculate saturation
    max_rgb = np.maximum(np.maximum(r, g), b)
    min_rgb = np.minimum(np.minimum(r, g), b)
    saturation = np.zeros_like(max_rgb)
    non_zero_mask = max_rgb > 0
    saturation[non_zero_mask] = (max_rgb[non_zero_mask] - min_rgb[non_zero_mask]) / max_rgb[non_zero_mask]
    
    # Gold typically has r > g > b and good saturation
    # Be more strict to remove white/gray edge artifacts
    is_gold = (r > g) & (g > b * 0.85) & (saturation > 0.20) & (a > 120)
    
    # Keep pixels with high saturation (clearly colored, not white/gray)
    is_saturated = (saturation > 0.25) & (a > 150)
    
    # Combine masks
    keep_mask = is_gold | is_saturated
    
    # Create new array
    new_arr = arr.copy()
    
    # For pixels we're keeping, also clean up any white tint
    # by slightly reducing brightness of low-saturation pixels at edges
    edge_pixels = keep_mask & (saturation < 0.3)
    
    # Make low-saturation edge pixels more transparent
    alpha_factor = np.ones_like(a)
    alpha_factor[edge_pixels] = saturation[edge_pixels] / 0.3  # Fade based on saturation
    
    new_arr[:,:,3] = new_arr[:,:,3] * alpha_factor
    
    # Remove pixels that don't pass the mask
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

# Extract each icon
for name, col, row in icons:
    # Calculate crop box for this cell (top portion only, avoid text)
    left = int(cell_width * col)
    right = int(cell_width * (col + 1))
    top = int(cell_height * row)
    bottom = int(cell_height * row + cell_height * 0.70)  # Take 70% to include full icons
    
    # Crop the cell
    icon_img = img.crop((left, top, right, bottom))
    
    # Extract gold icon
    icon_img = extract_gold_icon(icon_img)
    
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

# Copy movie and end show to main Icons folder
import shutil
shutil.copy(os.path.join(OUTPUT_DIR, "movie_time.png"), 
            "/Users/santiarano/Desktop/CODING PROJECTS/standbyme/webos-app/Icons/movie_time.png")
shutil.copy(os.path.join(OUTPUT_DIR, "end_show.png"), 
            "/Users/santiarano/Desktop/CODING PROJECTS/standbyme/webos-app/Icons/end_show.png")

print("\nDone! Gold icons extracted with transparent background.")
