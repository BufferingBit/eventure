import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Create storage engine based on environment
const getStorage = (folder) => {
  if (process.env.NODE_ENV === 'production') {
    // Use Cloudinary storage in production
    return new CloudinaryStorage({
      cloudinary: cloudinary,
      params: {
        folder: folder,
        allowed_formats: ['jpg', 'jpeg', 'png', 'gif'],
        transformation: [{ width: 1000, height: 1000, crop: 'limit' }]
      }
    });
  } else {
    // Use local disk storage in development
    const uploadDir = path.join(__dirname, '..', 'public', 'images', folder);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    // Return disk storage
    return multer.diskStorage({
      destination: function (req, file, cb) {
        cb(null, uploadDir);
      },
      filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + '-' + file.originalname);
      }
    });
  }
};

// Create upload middleware for different types of images
export const createUploader = (folder) => {
  return multer({ storage: getStorage(folder) });
};

// Helper function to get image URL (handles both local and Cloudinary paths)
export const getImageUrl = (path) => {
  if (!path) return null;
  
  // If it's already a full URL (Cloudinary), return as is
  if (path.startsWith('http')) {
    return path;
  }
  
  // For local development, prepend with /
  return path.startsWith('/') ? path : `/${path}`;
};

export default cloudinary;
