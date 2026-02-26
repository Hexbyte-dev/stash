# Auto-Scan Business Cards on Photo Upload

## Problem
Currently, when a user uploads a business card photo, they must manually click "Scan" to trigger OCR. The user wants scanning to happen automatically the moment a photo is stashed.

## Design

### Trigger
Every photo uploaded gets auto-scanned via the Railway backend OCR endpoint. If the image isn't a business card, OCR returns null and the item stays as a regular photo.

### Flow
1. User drops/uploads a photo and hits "Stash"
2. Item is created immediately as a `photo` type (card appears instantly with the image)
3. `extractBusinessCard` is called in the background using the new item's image data
4. `scanningId` is set to the item's ID so the card shows a scanning overlay
5. On success: item content is replaced with formatted contact lines, type changes to `contact`, tags updated, `ocrData` stored
6. On failure/not a card: `scanningId` clears, item stays as a regular photo

### Display
- While scanning: photo thumbnail stays visible with a semi-transparent "Scanning..." overlay
- After scan: overlay disappears, content updates to extracted lines (name, title, phone, email, etc.)
- Each field on its own line for easy copy-paste

### Code Changes
1. `addItem` function — add async OCR call after item creation when image is present
2. `StashCard` component — add overlay div on image when `isScanning` is true
3. Manual "Scan" button remains as fallback for older items

### What stays the same
- `extractBusinessCard`, `formatCardInfo`, Railway backend — unchanged
- Manual "Scan" button — still available for items without `ocrData`
- All other item types — unaffected
