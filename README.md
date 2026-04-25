# 🛒 Product Management Backend

Node.js + TypeScript REST API for adding products — single or bulk via CSV/Excel — with Cloudinary image uploads and MongoDB storage.

---

## 📁 Project Structure

```
src/
├── config/
│   ├── db.ts              # MongoDB connection
│   └── cloudinary.ts      # Cloudinary SDK init
├── controllers/
│   └── productController.ts   # Route handlers
├── middlewares/
│   ├── upload.ts          # Multer + Cloudinary storage
│   └── errorHandler.ts    # Global error handler
├── models/
│   └── Product.ts         # Mongoose schema & model
├── routes/
│   └── productRoutes.ts   # Express router
├── utils/
│   ├── fileParser.ts      # CSV / Excel parser
│   ├── validators.ts      # Zod schemas
│   └── response.ts        # API response helpers
└── index.ts               # App entry point
```

---

## ⚙️ Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Fill in your `.env`:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/productdb
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### 3. Run in development
```bash
npm run dev
```

### 4. Build for production
```bash
npm run build
npm start
```

---

## 🌐 API Endpoints

### ➕ Add Single Product
```
POST /api/products/single
Content-Type: multipart/form-data
```

| Field             | Type    | Required | Description                          |
|-------------------|---------|----------|--------------------------------------|
| name              | string  | ✅       | Product name                         |
| brand             | string  | ❌       | Brand name                           |
| category          | string  | ✅       | e.g. "groceries"                     |
| subCategory       | string  | ❌       | e.g. "Rice & Grains"                 |
| sellingPrice      | number  | ✅       | Selling price (₹)                    |
| originalPrice     | number  | ❌       | MRP (₹)                              |
| unit              | string  | ✅       | kg / g / litre / ml / pack / piece / dozen / box |
| weightOrSize      | string  | ❌       | e.g. "5kg", "500ml"                  |
| stockQuantity     | number  | ✅       | Available stock                      |
| minOrderQuantity  | number  | ❌       | Default: 1                           |
| description       | string  | ❌       | Product description                  |
| image             | file    | ❌       | Image file (JPG/PNG/WebP, max 5MB)   |
| tags              | string  | ❌       | Comma-separated: "Organic,Best Seller"|
| isFastMoving      | boolean | ❌       | true/false                           |
| isFeatured        | boolean | ❌       | true/false                           |

**Response (201):**
```json
{
  "success": true,
  "message": "Product added successfully",
  "data": { "_id": "...", "name": "...", "imageUrl": "https://res.cloudinary.com/..." }
}
```

---

### 📤 Bulk Upload Products
```
POST /api/products/bulk
Content-Type: multipart/form-data
```

| Field | Type | Required | Description             |
|-------|------|----------|-------------------------|
| file  | file | ✅       | .csv or .xlsx file      |

**CSV Column Format:**

| Column         | Required | Notes                              |
|----------------|----------|------------------------------------|
| name           | ✅       |                                    |
| brand          | ❌       |                                    |
| category       | ✅       |                                    |
| sub_category   | ❌       |                                    |
| price          | ✅       | Selling price                      |
| original_price | ❌       | MRP                                |
| unit           | ❌       | Default: pack                      |
| weight         | ❌       | e.g. 5kg                           |
| description    | ❌       |                                    |
| image_url      | ❌       | Direct URL (Unsplash/CDN)          |
| min_order_qty  | ❌       | Default: 1                         |
| fast_moving    | ❌       | yes / no                           |
| featured       | ❌       | yes / no                           |
| stock          | ✅       |                                    |
| tags           | ❌       | Comma-separated in quotes          |

> **Note:** Bulk upload uses `image_url` strings. File-based image upload is only for single product.

**Response (201 / 207 partial):**
```json
{
  "success": true,
  "message": "All 5 products uploaded successfully.",
  "data": {
    "totalRows": 5,
    "successCount": 5,
    "failedCount": 0,
    "insertedProducts": [...],
    "failedRows": []
  }
}
```

---

### 📋 Get All Products
```
GET /api/products?page=1&limit=20&category=groceries&featured=true&search=rice
```

---

### 🔍 Get Product by ID
```
GET /api/products/:id
```

---

### 🗑️ Delete Product
```
DELETE /api/products/:id
```
> Also deletes the image from Cloudinary automatically.

---

## 🖼️ Image Upload Flow (Single Product)

```
Client → POST /api/products/single (multipart)
           ↓
         Multer intercepts "image" field
           ↓
         multer-storage-cloudinary uploads to Cloudinary
           ↓
         req.file.path  = secure_url  (stored in DB as imageUrl)
         req.file.filename = public_id (stored in DB as imagePublicId)
           ↓
         Product saved to MongoDB
```

---

## 🧰 Tech Stack

| Layer        | Technology                      |
|-------------|----------------------------------|
| Runtime      | Node.js                         |
| Language     | TypeScript                      |
| Framework    | Express.js                      |
| Database     | MongoDB + Mongoose              |
| Image CDN    | Cloudinary                      |
| Upload       | Multer + multer-storage-cloudinary |
| Validation   | Zod                             |
| CSV/Excel    | csv-parse + xlsx                |
