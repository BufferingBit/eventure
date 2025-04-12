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
const configureCloudinary = () => {
  // Check if all required environment variables are set
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    console.warn('Cloudinary environment variables are not set properly. Image uploads to cloud will not work.');
    console.warn('Required variables: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
    console.warn('Current values:', { cloudName, apiKey: apiKey ? '****' : undefined, apiSecret: apiSecret ? '****' : undefined });
    return false;
  }

  try {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true
    });
    return true;
  } catch (error) {
    console.error('Error configuring Cloudinary:', error);
    return false;
  }
};

// Initialize Cloudinary
const cloudinaryConfigured = configureCloudinary();

// Create storage engine based on environment
const getStorage = (folder) => {
  // Check if we're in production and Cloudinary is configured
  if (process.env.NODE_ENV === 'production' && cloudinaryConfigured) {
    try {
      // Use Cloudinary storage in production
      return new CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
          folder: folder,
          allowed_formats: ['jpg', 'jpeg', 'png', 'gif'],
          transformation: [{ width: 1000, height: 1000, crop: 'limit' }]
        }
      });
    } catch (error) {
      console.error('Error creating Cloudinary storage:', error);
      console.warn('Falling back to local storage for uploads');
      // Fall back to local storage if Cloudinary fails
    }
  }

  // Use local disk storage in development or if Cloudinary fails
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
};

// Create upload middleware for different types of images
export const createUploader = (folder) => {
  return multer({ storage: getStorage(folder) });
};

// Helper function to get image URL (handles both local and Cloudinary paths)
export const getImageUrl = (path, defaultImage = null) => {
  if (!path) return defaultImage;

  // If it's already a full URL (Cloudinary), return as is
  if (path.startsWith('http')) {
    return path;
  }

  // For local development, prepend with / if needed
  return path.startsWith('/') ? path : `/${path}`;
};

// Export a function to add to res.locals for use in templates
export const addImageHelpers = (app) => {
  app.use((req, res, next) => {
    res.locals.getImageUrl = getImageUrl;
    next();
  });
};

export default cloudinary;
