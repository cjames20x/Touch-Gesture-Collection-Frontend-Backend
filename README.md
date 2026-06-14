# Touch Gesture Collection - Frontend & Backend

A full-stack web application for collecting, processing, and analyzing touch gesture data using machine learning. This system combines a web-based data collection interface with a Python backend for feature extraction, model training, and gesture recognition using Hidden Markov Models (HMM).

## Features

- **Gesture Data Collection**: Web-based interface for capturing touch gesture sequences
- **User Management**: Registration and user authentication system
- **Feature Extraction**: Automated extraction of gesture features from raw touch data
- **Model Training**: Hidden Markov Model training using collected gesture data
- **Gesture Recognition**: Real-time evaluation and classification of touch gestures
- **Data Evaluation**: Comprehensive evaluation metrics and performance analysis
- **Responsive Design**: Mobile-friendly web interface for data collection

## Tech Stack

### Frontend
- **HTML5** - Markup structure
- **CSS3** - Styling and responsive design
- **JavaScript/TypeScript** - Interactive components and API communication
- **Vanilla JS** - Client-side logic (no external frameworks)

### Backend
- **Python 3** - Core backend language
- **Flask** - Web API framework
- **scikit-learn / hmmlearn** - Machine learning libraries
- **NumPy/SciPy** - Numerical computing

## Project Structure

```
├── Frontend (Web Interface)
│   ├── index.html              # Landing/home page
│   ├── register.html           # User registration page
│   ├── consent.html            # Data consent form
│   ├── instructions.html       # Gesture collection instructions
│   ├── training.html           # Training data collection interface
│   ├── selection.html          # Gesture selection screen
│   ├── sequence.html           # Gesture sequence recording
│   ├── eval.html              # Evaluation/testing interface
│   ├── user.html              # User profile page
│   ├── index.css              # Main stylesheet
│   ├── eval.js                # Evaluation logic
│   ├── selection.js           # Selection interface logic
│   ├── api-client.js          # API communication client
│   └── tsconfig.json          # TypeScript configuration
│
├── Backend (Python API)
│   ├── main.py                # Application entry point & Flask app
│   ├── api.py                 # API endpoint definitions
│   ├── gesture_data.py        # Gesture data models & handling
│   ├── feature_extractor.py   # Feature extraction from raw data
│   ├── hmm_trainer.py         # HMM model training
│   ├── evaluator.py           # Model evaluation & testing
│   └── __pycache__/           # Python cache (generated)
│
├── dist/                      # Build/distribution output
├── src/                       # Additional source files
└── README.md                  # This file
```

## Installation

### Prerequisites
- Python 3.7 or higher
- Node.js 12+ (optional, for build tools)
- Modern web browser (Chrome, Firefox, Safari, Edge)

### Backend Setup

1. Clone the repository:
```bash
git clone https://github.com/cjames20x/Touch-Gesture-Collection-Frontend-Backend.git
cd Touch-Gesture-Collection-Frontend-Backend
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install Python dependencies:
```bash
pip install flask numpy scipy scikit-learn hmmlearn
```

4. Run the Flask server:
```bash
python main.py
```

The API will start on `http://localhost:5000` by default.

### Frontend Setup

1. Open the frontend in a web browser:
```bash
# Navigate to the project directory and open index.html
open index.html  # macOS
# or
start index.html  # Windows
# or drag index.html into your browser
```

2. Alternatively, serve files using a local web server:
```bash
# Python 3
python -m http.server 8000

# Then open http://localhost:8000 in your browser
```

## Usage

### Data Collection Workflow

1. **Register User**: Start at `register.html` to create a new user account
2. **Accept Consent**: Review and accept the data consent form
3. **Read Instructions**: Review gesture collection guidelines
4. **Collect Training Data**: Use `training.html` to record gesture examples
5. **Train Model**: Backend processes data and trains HMM models
6. **Evaluate**: Use `eval.html` to test gesture recognition accuracy

### API Endpoints

#### User Management
- `POST /api/register` - Register new user
- `POST /api/login` - User login
- `GET /api/user/<user_id>` - Get user profile

#### Gesture Collection
- `POST /api/gestures` - Submit collected gesture data
- `GET /api/gestures/<user_id>` - Retrieve user's gesture data
- `DELETE /api/gestures/<gesture_id>` - Delete a gesture

#### Model Training & Evaluation
- `POST /api/train` - Train HMM model for user
- `POST /api/evaluate` - Evaluate gesture recognition
- `GET /api/results/<user_id>` - Get evaluation results

## Development

### Modifying the Frontend

Edit HTML files directly for structure changes, update `index.css` for styling, and modify JavaScript files for logic changes.

### Modifying the Backend

Key backend components:
- **`gesture_data.py`**: Modify data structures and validation logic
- **`feature_extractor.py`**: Adjust feature extraction algorithms
- **`hmm_trainer.py`**: Tune HMM model training parameters
- **`evaluator.py`**: Modify evaluation metrics and thresholds

### Adding New Features

1. Create new HTML pages in the root directory
2. Add corresponding JavaScript logic files
3. Implement API endpoints in `api.py`
4. Add supporting backend logic in appropriate modules

## Configuration

Key configuration variables (found in backend files):
- Flask server port and host
- Model training parameters (HMM states, covariance type, etc.)
- Data validation rules
- API endpoints

## Testing

To test the system:
1. Navigate to `eval.html` in your browser
2. Perform touch gestures on the canvas
3. The system will evaluate gestures against trained models
4. Review accuracy metrics and results

## File Descriptions

| File | Purpose |
|------|---------|
| `main.py` | Flask application entry point, server initialization |
| `api.py` | REST API endpoint definitions |
| `gesture_data.py` | Data models for gesture objects and user profiles |
| `feature_extractor.py` | Extracts numerical features from raw touch coordinates |
| `hmm_trainer.py` | Trains Hidden Markov Models on gesture feature vectors |
| `evaluator.py` | Evaluates model performance on test gestures |
| `api-client.js` | JavaScript HTTP client for backend API calls |

## Known Limitations

- Single HMM model per gesture type
- Limited to 2D touch input
- Requires manual gesture selection for training
- No persistent database (data stored in memory/files)

## Future Enhancements

- Integration with database system (MongoDB, PostgreSQL)
- Deep learning models (LSTM, CNN) for gesture recognition
- Multi-touch support
- Gesture sequence recognition
- Real-time performance analytics
- Model versioning and comparison

## Troubleshooting

### Backend Won't Start
- Ensure Python 3.7+ is installed: `python --version`
- Verify dependencies: `pip list | grep flask`
- Check if port 5000 is available

### Frontend Can't Connect to API
- Verify backend is running on `http://localhost:5000`
- Check browser console for CORS errors
- Ensure `api-client.js` has correct server URL

### Gesture Recognition Inaccurate
- Ensure sufficient training data collected (≥20 samples per gesture)
- Verify features are being extracted correctly
- Check HMM model parameters in `hmm_trainer.py`

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contributing

Contributions are welcome! To contribute:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Contact

For questions or support, please contact the project maintainer or open an issue on GitHub.

---

**Last Updated**: June 2026
