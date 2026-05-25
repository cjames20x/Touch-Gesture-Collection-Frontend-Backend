export interface Gesture {
    type: string;
    points: Points[];
}

export interface Points {
    time: DOMHighResTimeStamp;
    x: number;
    y: number;
    pressure: number;
}

export interface Vector2 {
    x: number;
    y: number;
}

export interface GestureDataRaw {
    timestamp: string;
    type: string;
    touch_position: Points[];
}
