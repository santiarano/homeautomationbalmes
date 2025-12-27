#!/usr/bin/env python3
"""
Script to colorize PNG icons for the StandByMe dashboard.
Creates gold and white versions of the icons.
"""

from PIL import Image
import os

# Gold color (RGB) - matching the button color rgba(230,190,138)
GOLD_COLOR = (230, 190, 138)
WHITE_COLOR = (255, 255, 255)

def colorize_icon(input_path, output_path, target_color):
    """
    Colorize a black PNG icon to the target color.
    
    Args:
        input_path: Path to the input PNG file
        output_path: Path to save the colorized PNG
        target_color: RGB tuple for the target color
    """
    # Open the image
    img = Image.open(input_path).convert("RGBA")
    pixels = img.load()
    
    width, height = img.size
    
    # Create a new image with the same size
    new_img = Image.new("RGBA", (width, height))
    new_pixels = new_img.load()
    
    # Process each pixel
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            
            # If pixel is not transparent
            if a > 0:
                # Calculate the brightness/intensity of the original pixel
                # Use average RGB for simplicity
                original_brightness = (r + g + b) / 3.0
                
                # For black icons, we want to map:
                # - Pure black (brightness 0) -> full target color
                # - White/gray (brightness 255) -> lighter version of target color
                
                # Invert the brightness: black (0) should become full color, white (255) should become lighter
                # Use inverted brightness as a factor
                inverted_brightness = 1.0 - (original_brightness / 255.0)
                
                # For very dark pixels (black), use full target color
                # For lighter pixels, blend target color with white
                if original_brightness < 10:
                    # Pure black or very dark -> full target color
                    new_r, new_g, new_b = target_color
                elif original_brightness > 240:
                    # Very light/white -> blend target color with white (lighter shade)
                    blend = (original_brightness - 240) / 15.0  # 0 to 1
                    new_r = int(target_color[0] * (1 - blend) + 255 * blend)
                    new_g = int(target_color[1] * (1 - blend) + 255 * blend)
                    new_b = int(target_color[2] * (1 - blend) + 255 * blend)
                else:
                    # Medium gray -> use inverted brightness to scale target color
                    # Darker pixels get more of the target color
                    new_r = int(target_color[0] * inverted_brightness)
                    new_g = int(target_color[1] * inverted_brightness)
                    new_b = int(target_color[2] * inverted_brightness)
                
                # Preserve alpha channel
                new_pixels[x, y] = (new_r, new_g, new_b, a)
            else:
                # Keep transparent pixels transparent
                new_pixels[x, y] = (0, 0, 0, 0)
    
    # Save the colorized image
    new_img.save(output_path, "PNG")
    print(f"✓ Created: {output_path}")

def main():
    # Get the script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(script_dir, "webos-app", "Icons")
    
    # Icons that should be gold (Open Awning, Movie Time)
    gold_icons = ["open awning.png", "movie time.png"]
    
    # Icons that should be white (Close Awning, End Show)
    white_icons = ["close awning.png", "end show.png"]
    
    # Create colorized versions
    for icon_name in gold_icons:
        input_path = os.path.join(icons_dir, icon_name)
        if os.path.exists(input_path):
            # Create gold version
            base_name = os.path.splitext(icon_name)[0]
            output_path = os.path.join(icons_dir, f"{base_name}_gold.png")
            colorize_icon(input_path, output_path, GOLD_COLOR)
        else:
            print(f"⚠ Warning: {input_path} not found")
    
    for icon_name in white_icons:
        input_path = os.path.join(icons_dir, icon_name)
        if os.path.exists(input_path):
            # Create white version
            base_name = os.path.splitext(icon_name)[0]
            output_path = os.path.join(icons_dir, f"{base_name}_white.png")
            colorize_icon(input_path, output_path, WHITE_COLOR)
        else:
            print(f"⚠ Warning: {input_path} not found")
    
    print("\n✓ All icons colorized successfully!")
    print("\nNext steps:")
    print("1. Update index.html to use the new _gold.png and _white.png files")
    print("2. Remove the CSS filters since the icons are now pre-colored")

if __name__ == "__main__":
    main()

