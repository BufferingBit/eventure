export const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
    
    if (err.type === 'database') {
        return res.status(500).render('error', {
            message: 'Database error occurred',
            error: process.env.NODE_ENV === 'development' ? err : {}
        });
    }
    
    res.status(500).render('error', {
        message: 'Something went wrong',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
};