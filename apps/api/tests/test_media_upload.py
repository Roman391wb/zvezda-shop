import io

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image
from starlette.datastructures import Headers

from app.admin import store_upload
from app.config import settings


@pytest.mark.asyncio
async def test_image_upload_uses_safe_name_and_rejects_invalid_video(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "media_root", str(tmp_path))
    image_bytes = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(image_bytes, format="PNG")
    upload = UploadFile(filename="unsafe name.png", file=io.BytesIO(image_bytes.getvalue()), headers=Headers({"content-type": "image/png"}))
    url, media_type = await store_upload(upload)
    assert media_type == "image"
    assert url.startswith("/media/products/")
    assert "unsafe" not in url
    bad_video = UploadFile(filename="video.mp4", file=io.BytesIO(b"not a video"), headers=Headers({"content-type": "video/mp4"}))
    with pytest.raises(HTTPException) as error:
        await store_upload(bad_video)
    assert error.value.status_code == 415
