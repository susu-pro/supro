from flask import Flask

def init_app(app):
    from .call_records import call_records_bp
    
    # Blueprint+URL前缀
    app.register_blueprint(call_records_bp, url_prefix='/api/call-records')
    
    return app